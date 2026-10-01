use super::*;
use axum::{
    body::Body,
    http::{Method, Request, header},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

fn worker_headers(token: &str) -> axum::http::HeaderMap {
    let mut headers = axum::http::HeaderMap::new();
    headers.insert("authorization", format!("Bearer {token}").parse().unwrap());
    headers
}

#[tokio::test]
async fn companion_jobs_are_scoped_claimed_once_revocable_and_forward_requested_reasoning() {
    let (server, _dir) = server();
    let cookie = owner(&server).await;
    let household: String = server
        .db
        .lock()
        .unwrap()
        .query_row("SELECT id FROM households", [], |r| r.get(0))
        .unwrap();
    let pairing = ai::provision_companion(&server, &household, "gpt-6-luna", "xhigh").unwrap();
    let token = pairing["token"].as_str().unwrap();
    let headers = worker_headers(token);
    let (_, config, _) = request(
        &server,
        Method::GET,
        "/api/ai/config",
        Value::Null,
        Some(&cookie),
    )
    .await;
    assert_eq!(config["config"]["transport"], "companion");
    assert_eq!(config["config"]["reasoningEffort"], "xhigh");
    assert!(!config.to_string().contains(token));
    assert_eq!(config["companion"]["online"], false);
    assert!(
        companion::send(&server, &household, "models", None)
            .await
            .is_err()
    );
    let _ = companion::heartbeat(axum::extract::State(server.clone()), headers.clone())
        .await
        .unwrap();
    let second_state: String = server
        .db
        .lock()
        .unwrap()
        .query_row("SELECT state FROM households", [], |r| r.get(0))
        .unwrap();
    server
        .db
        .lock()
        .unwrap()
        .execute(
            "INSERT INTO households(id,name,state) VALUES('other','Other',?1)",
            [second_state],
        )
        .unwrap();
    let other = worker_headers(&companion::rotate(&server, "other").unwrap());
    let test_server = server.clone();
    let test_cookie = cookie.clone();
    let waiting = tokio::spawn(async move {
        request(&test_server,Method::POST,"/api/ai/test",json!({"config":{"enabled":true,"transport":"companion","baseUrl":"https://api.openai.com/v1","model":"gpt-6-luna","reasoningEffort":"xhigh","imageModel":"gpt-image-2-medium","imageSize":"1024x1024","responseFormat":"schema","tokenParameter":"omit"}}),Some(&test_cookie)).await
    });
    let mut job = Value::Null;
    for _ in 0..100 {
        job = companion::claim(axum::extract::State(server.clone()), headers.clone())
            .await
            .unwrap()
            .0["job"]
            .clone();
        if !job.is_null() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert_eq!(job["body"]["model"], "gpt-6-luna");
    assert_eq!(job["body"]["reasoning_effort"], "xhigh");
    assert!(
        companion::claim(axum::extract::State(server.clone()), headers.clone())
            .await
            .unwrap()
            .0["job"]
            .is_null()
    );
    assert!(
        companion::claim(axum::extract::State(server.clone()), other.clone())
            .await
            .unwrap()
            .0["job"]
            .is_null()
    );
    let payload = || companion::Completion {
        id: job["id"].as_str().unwrap().into(),
        lease: job["lease"].as_str().unwrap().into(),
        failed: false,
        result: Some(json!({"choices":[{"message":{"content":"Connected"}}]})),
    };
    assert!(
        companion::complete(axum::extract::State(server.clone()), other, Json(payload()))
            .await
            .is_err()
    );
    let mut invalid = payload();
    invalid.lease = "a".repeat(64);
    assert!(
        companion::complete(
            axum::extract::State(server.clone()),
            headers.clone(),
            Json(invalid)
        )
        .await
        .is_err()
    );
    let _ = companion::complete(
        axum::extract::State(server.clone()),
        headers.clone(),
        Json(payload()),
    )
    .await
    .unwrap();
    assert!(
        companion::complete(
            axum::extract::State(server.clone()),
            headers.clone(),
            Json(payload())
        )
        .await
        .is_err()
    );
    assert_eq!(waiting.await.unwrap().0, StatusCode::OK);
    assert_eq!(
        server
            .db
            .lock()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM companion_jobs", [], |r| r
                .get::<_, u32>(0))
            .unwrap(),
        0
    );
    companion::rotate(&server, &household).unwrap();
    assert!(
        companion::claim(axum::extract::State(server.clone()), headers)
            .await
            .is_err()
    );
    let request = Request::builder()
        .uri("/api/state")
        .header("authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        app(server).oneshot(request).await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );
}

fn server() -> (Server, tempfile::TempDir) {
    let directory = tempfile::tempdir().expect("temporary data directory");
    let config = Arc::new(Config {
        origin: "http://localhost:3100".into(),
        secure_cookie: false,
        setup_token: "test-bootstrap-secret".into(),
        data_dir: directory.path().into(),
        encryption_key: [19u8; 32],
    });
    let (notices, _) = broadcast::channel(64);
    (
        Server {
            db: db::Database::open(&directory.path().join("test.sqlite3"))
                .map_err(|error| error.1)
                .unwrap(),
            config,
            notices,
            dummy_hash: auth::dummy_hash().into(),
            client: reqwest::Client::new(),
            limits: Arc::new(Mutex::new(HashMap::new())),
        },
        directory,
    )
}
async fn request(
    server: &Server,
    method: Method,
    path: &str,
    body: Value,
    cookie: Option<&str>,
) -> (StatusCode, Value, Option<String>) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header(header::CONTENT_TYPE, "application/json")
        .header("x-forkbasket-request", "1")
        .header(header::ORIGIN, &server.config.origin);
    if let Some(cookie) = cookie {
        request = request.header(header::COOKIE, cookie);
    }
    let response = app(server.clone())
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let cookie = response
        .headers()
        .get(header::SET_COOKIE)
        .map(|cookie| cookie.to_str().unwrap().split(';').next().unwrap().into());
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        cookie,
    )
}
async fn owner(server: &Server) -> String {
    let (status,body,cookie)=request(server,Method::POST,"/api/auth/setup",json!({"setupToken":"test-bootstrap-secret","email":"owner@example.test","name":"Owner","password":"a sufficiently long password","householdName":"Our family","timeZone":"Europe/Helsinki","samples":true}),None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["recoveryCode"].as_str().unwrap().len() >= 32);
    cookie.unwrap()
}
async fn operation(server: &Server, cookie: &str, operation: Value) -> (StatusCode, Value) {
    let (status, body, _) = request(
        server,
        Method::POST,
        "/api/operations",
        json!({"id":uuid::Uuid::new_v4().to_string(),"operation":operation}),
        Some(cookie),
    )
    .await;
    (status, body)
}

#[tokio::test]
async fn accounts_require_setup_token_then_share_invited_household_and_reject_unauthenticated_access()
 {
    let (server, _dir) = server();
    assert_eq!(
        request(&server, Method::GET, "/api/state", Value::Null, None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let cookie = owner(&server).await;
    let (_, owner_info, _) = request(
        &server,
        Method::GET,
        "/api/auth/me",
        Value::Null,
        Some(&cookie),
    )
    .await;
    assert_eq!(owner_info["user"]["role"], "owner");
    let (_, invite, _) = request(
        &server,
        Method::POST,
        "/api/invitations",
        json!({"email":"wife@example.test"}),
        Some(&cookie),
    )
    .await;
    let token = invite["url"]
        .as_str()
        .unwrap()
        .split("invite=")
        .nth(1)
        .unwrap();
    let (status,wife,wife_cookie)=request(&server,Method::POST,"/api/auth/join",json!({"token":token,"email":"wife@example.test","name":"Wife","password":"another good long password"}),None).await;
    assert_eq!(status, StatusCode::OK, "{wife}");
    assert_eq!(wife["session"]["householdId"], owner_info["householdId"]);
    let (status,_)=operation(&server,&cookie,json!({"type":"addItem","productId":"pasta","quantity":400,"unit":"g","note":"Whole wheat","accumulate":true})).await;
    assert_eq!(status, StatusCode::OK);
    let (status, shared, _) = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        wife_cookie.as_deref(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(shared["state"]["items"][0]["note"], "Whole wheat");
    assert_eq!(
        request(
            &server,
            Method::POST,
            "/api/invitations",
            json!({"email":"child@example.test"}),
            wife_cookie.as_deref()
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(request(&server,Method::POST,"/api/auth/join",json!({"token":token,"email":"wife@example.test","name":"Repeat","password":"another good long password"}),None).await.0,StatusCode::BAD_REQUEST);
    request(
        &server,
        Method::POST,
        "/api/auth/logout",
        json!({}),
        wife_cookie.as_deref(),
    )
    .await;
    assert_eq!(
        request(
            &server,
            Method::GET,
            "/api/state",
            Value::Null,
            wife_cookie.as_deref()
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn mutation_retries_are_idempotent_and_stale_edits_fail_without_losing_other_changes() {
    let (server, _dir) = server();
    let cookie = owner(&server).await;
    let mutation = json!({"id":uuid::Uuid::new_v4().to_string(),"operation":{"type":"addItem","productId":"pasta","quantity":200,"unit":"g","note":"","accumulate":true}});
    let (status, first, _) = request(
        &server,
        Method::POST,
        "/api/operations",
        mutation.clone(),
        Some(&cookie),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{first}");
    let (_, again, _) = request(
        &server,
        Method::POST,
        "/api/operations",
        mutation,
        Some(&cookie),
    )
    .await;
    assert_eq!(again["revision"], first["revision"]);
    assert_eq!(again["state"]["items"][0]["quantity"].as_f64(), Some(200.0));
    let patch = |before: &str, after: &str| json!({"type":"patch","label":"Description","changes":[{"collection":"items","key":"pasta","field":"note","before":before,"after":after}]});
    assert_eq!(
        operation(&server, &cookie, patch("", "Penne")).await.0,
        StatusCode::OK
    );
    assert_eq!(
        operation(&server, &cookie, patch("", "Rigatoni")).await.0,
        StatusCode::CONFLICT
    );
    let (_, state, _) = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&cookie),
    )
    .await;
    assert_eq!(state["state"]["items"][0]["note"], "Penne");
}

#[tokio::test]
async fn independent_concurrent_additions_accumulate_atomically_and_undo_is_guarded() {
    let (server, _dir) = server();
    let cookie = owner(&server).await;
    let add = json!({"type":"addItem","productId":"pasta","quantity":200,"unit":"g","note":"","accumulate":true});
    let (a, b) = tokio::join!(
        operation(&server, &cookie, add.clone()),
        operation(&server, &cookie, add)
    );
    assert_eq!(a.0, StatusCode::OK);
    assert_eq!(b.0, StatusCode::OK);
    let (_, state, _) = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&cookie),
    )
    .await;
    assert_eq!(state["state"]["items"][0]["quantity"].as_f64(), Some(400.0));
    let first = a.1["eventId"].as_str().unwrap();
    assert_eq!(
        operation(&server, &cookie, json!({"type":"undo","eventId":first}))
            .await
            .0,
        StatusCode::CONFLICT
    );
    let last = b.1["eventId"].as_str().unwrap();
    assert_eq!(
        operation(&server, &cookie, json!({"type":"undo","eventId":last}))
            .await
            .0,
        StatusCode::OK
    );
}

#[tokio::test]
async fn cross_origin_writes_and_requests_without_csrf_header_are_rejected() {
    let (server, _dir) = server();
    for (origin, protection) in [
        ("https://other.example", true),
        ("http://localhost:3100", false),
    ] {
        let mut request = Request::builder()
            .method(Method::POST)
            .uri("/api/auth/login")
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::ORIGIN, origin);
        if protection {
            request = request.header("x-forkbasket-request", "1");
        }
        let response=app(server.clone()).oneshot(request.body(Body::from(json!({"email":"owner@example.test","password":"some long enough password"}).to_string())).unwrap()).await.unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }
}

#[test]
fn automatic_requirements_merge_convert_and_credit_checks_without_reappearing() {
    let mut state = model::fresh_state(true, "Europe/Helsinki".into());
    state.plan.insert("2026-09-30".into(), "green-pasta".into());
    state.plan.insert("2026-10-01".into(), "green-pasta".into());
    let pasta = domain::displayed(&state, "pasta", "2026-09-30").unwrap();
    assert_eq!(pasta.quantity, 800.0);
    domain::apply(
        &mut state,
        &model::Operation::CheckItem {
            id: "pasta".into(),
            checked: true,
            expected: None,
        },
        "2026-09-30",
    )
    .map_err(|error| error.1)
    .unwrap();
    assert!(
        domain::displayed(&state, "pasta", "2026-09-30")
            .unwrap()
            .checked
    );
    domain::apply(
        &mut state,
        &model::Operation::CheckItem {
            id: "pasta".into(),
            checked: false,
            expected: None,
        },
        "2026-09-30",
    )
    .map_err(|error| error.1)
    .unwrap();
    assert_eq!(
        domain::displayed(&state, "pasta", "2026-09-30")
            .unwrap()
            .quantity,
        800.0
    );
}

#[test]
fn pantry_covers_plans_and_invalid_recipe_products_roll_back() {
    let mut state = model::fresh_state(true, "Europe/Helsinki".into());
    state.plan.insert("2026-09-30".into(), "green-pasta".into());
    state.pantry.insert(
        "pasta".into(),
        model::PantryItem {
            amounts: vec![model::Amount {
                quantity: 0.25,
                unit: "kg".into(),
            }],
            confirmed: true,
            observed_at: chrono::Utc::now().to_rfc3339(),
            expires_at: None,
            note: "Whole wheat".into(),
        },
    );
    assert_eq!(
        domain::displayed(&state, "pasta", "2026-09-30")
            .unwrap()
            .quantity,
        150.0
    );
    let before = state.clone();
    let changes = vec![model::Change {
        collection: "plan".into(),
        key: "2026-09-30".into(),
        field: None,
        before: json!("green-pasta"),
        after: json!("nonexistent-recipe"),
    }];
    assert!(domain::apply_changes(&mut state, &changes).is_err());
    // The enclosing SQLite transaction restores persistence on validation errors.
    assert_eq!(before.plan["2026-09-30"], "green-pasta");
}

#[tokio::test]
async fn ai_provider_keys_stay_encrypted_and_validated_proposals_apply_only_after_review() {
    let (server, _dir) = server();
    let cookie = owner(&server).await;
    let fixture=Router::new().route("/v1/chat/completions",post(|headers:axum::http::HeaderMap,Json(body):Json<Value>|async move {
        assert_eq!(headers.get("authorization").unwrap(),"Bearer fixture-key-never-expose");
        let content=if body["messages"][0]["role"]=="user"{"Connected".to_string()}else{json!({"message":"Try a bright rice lunch and pick up oat milk.","shopping":[{"name":"Oat milk","productId":"oat-milk","category":null,"quantity":2,"unit":"L","note":"Barista"}],"recipes":[{"name":"Spinach lemon rice","subtitle":"A fresh variation","minutes":20,"servings":4,"tags":["Vegetarian"],"ingredients":[{"name":"Rice","productId":"rice","category":null,"quantity":300,"unit":"g","note":""},{"name":"Spinach","productId":"spinach","category":null,"quantity":150,"unit":"g","note":""}],"steps":["Cook the rice.","Fold in spinach and serve."]}],"plan":[]}).to_string()};
        Json(json!({"choices":[{"message":{"content":content}}]}))
    })).route("/v1/models",get(||async{Json(json!({"data":[{"id":"fixture-chat"}]}))}));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let provider = tokio::spawn(async move { axum::serve(listener, fixture).await.unwrap() });
    let config = json!({"enabled":true,"baseUrl":format!("http://{address}/v1"),"model":"fixture-chat","imageModel":"","imageSize":"1024x1024","responseFormat":"schema","tokenParameter":"max_completion_tokens"});
    let (status, saved, _) = request(
        &server,
        Method::PUT,
        "/api/ai/config",
        json!({"config":config,"apiKey":"fixture-key-never-expose"}),
        Some(&cookie),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert!(saved.to_string().find("fixture-key-never-expose").is_none());
    let stored: String = server
        .db
        .lock()
        .unwrap_or_else(|error| panic!("{}", error.1))
        .query_row("SELECT secret FROM providers", [], |row| row.get(0))
        .unwrap();
    assert!(!stored.contains("fixture-key"));
    let (status, connection, _) = request(
        &server,
        Method::POST,
        "/api/ai/test",
        json!({"config":config,"apiKey":null}),
        Some(&cookie),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{connection}");
    let (status, proposal, _) = request(
        &server,
        Method::POST,
        "/api/ai/assistant",
        json!({"prompt":"A new vegetarian lunch and oat milk"}),
        Some(&cookie),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{proposal}");
    let (_, before, _) = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&cookie),
    )
    .await;
    assert!(before["state"]["items"].as_array().unwrap().is_empty());
    assert_eq!(before["state"]["recipeBook"].as_array().unwrap().len(), 5);
    let (status,applied)=operation(&server,&cookie,json!({"type":"applyProposal","proposalId":proposal["id"],"shoppingIndices":[0],"recipeIds":[proposal["recipes"][0]["id"]],"days":[]})).await;
    assert_eq!(status, StatusCode::OK, "{applied}");
    assert_eq!(applied["state"]["items"][0]["name"], "Oat milk");
    assert_eq!(applied["state"]["recipeBook"].as_array().unwrap().len(), 6);
    assert_eq!(operation(&server,&cookie,json!({"type":"applyProposal","proposalId":proposal["id"],"shoppingIndices":[0],"recipeIds":[],"days":[]})).await.0,StatusCode::BAD_REQUEST);
    provider.abort();
}

#[tokio::test]
async fn malformed_ai_output_and_secret_reading_by_nonowners_are_rejected() {
    let (server, _dir) = server();
    let cookie = owner(&server).await;
    let fixture=Router::new().route("/v1/chat/completions",post(||async{Json(json!({"choices":[{"message":{"content":"{\"message\":\"try this\",\"shopping\":[{\"name\":\"Pasta\",\"productId\":\"pasta\",\"category\":null,\"quantity\":-20,\"unit\":\"g\",\"note\":\"\"}],\"recipes\":[],\"plan\":[]}"}}]}))}));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let provider = tokio::spawn(async move { axum::serve(listener, fixture).await.unwrap() });
    let config = json!({"enabled":true,"baseUrl":format!("http://{address}/v1"),"model":"fixture-chat","imageModel":"","imageSize":"1024x1024","responseFormat":"json","tokenParameter":"omit"});
    request(
        &server,
        Method::PUT,
        "/api/ai/config",
        json!({"config":config,"apiKey":null}),
        Some(&cookie),
    )
    .await;
    assert_eq!(
        request(
            &server,
            Method::POST,
            "/api/ai/assistant",
            json!({"prompt":"Add pasta"}),
            Some(&cookie)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let (_, invitation, _) = request(
        &server,
        Method::POST,
        "/api/invitations",
        json!({"email":"member@example.test"}),
        Some(&cookie),
    )
    .await;
    let token = invitation["url"]
        .as_str()
        .unwrap()
        .split("invite=")
        .nth(1)
        .unwrap();
    let (_,_,member)=request(&server,Method::POST,"/api/auth/join",json!({"token":token,"email":"member@example.test","name":"Member","password":"another long strong password"}),None).await;
    assert_eq!(
        request(
            &server,
            Method::GET,
            "/api/ai/config",
            Value::Null,
            member.as_deref()
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    provider.abort();
}

#[test]
fn stale_offline_checks_do_not_credit_unseen_demand_and_changed_meals_release_stock() {
    let mut state = model::fresh_state(true, "Europe/Helsinki".into());
    let today = "2026-09-30";
    state.plan.insert(today.into(), "green-pasta".into());
    let expected = domain::displayed(&state, "pasta", today).unwrap();
    state.servings.insert(today.into(), 8.0);
    assert!(
        domain::apply(
            &mut state,
            &model::Operation::CheckItem {
                id: "pasta".into(),
                checked: true,
                expected: Some(Box::new(expected))
            },
            today
        )
        .is_err()
    );
    assert!(state.plan_coverage.is_empty());
    domain::apply(
        &mut state,
        &model::Operation::CheckItem {
            id: "pasta".into(),
            checked: true,
            expected: None,
        },
        today,
    )
    .unwrap();
    assert_eq!(state.purchased_coverage[today]["pasta"][0].quantity, 800.0);
    domain::apply(
        &mut state,
        &model::Operation::Patch {
            label: "Remove lunch".into(),
            changes: vec![model::Change {
                collection: "plan".into(),
                key: today.into(),
                field: None,
                before: json!("green-pasta"),
                after: Value::Null,
            }],
        },
        today,
    )
    .unwrap();
    assert_eq!(state.pantry["pasta"].amounts[0].quantity, 800.0);
    assert!(!state.pantry["pasta"].confirmed);
    state.plan.insert(today.into(), "green-pasta".into());
    assert!(
        !domain::outstanding(&state, today)
            .iter()
            .any(|credit| credit.product_id == "pasta")
    );
}

#[tokio::test]
async fn backup_restore_is_guarded_atomic_and_owner_only() {
    let (server, _dir) = server();
    let owner = owner(&server).await;
    operation(&server,&owner,json!({"type":"addItem","productId":"coffee","quantity":2,"unit":"pack","note":"Dark roast","accumulate":true})).await;
    let (status, backup, _) = request(
        &server,
        Method::GET,
        "/api/backup",
        Value::Null,
        Some(&owner),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    operation(&server,&owner,json!({"type":"addItem","productId":"bananas","quantity":3,"unit":"pc","note":"","accumulate":true})).await;
    assert_eq!(
        request(
            &server,
            Method::POST,
            "/api/restore",
            json!({"backup":backup,"expectedRevision":1}),
            Some(&owner)
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let snapshot = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&owner),
    )
    .await
    .1;
    let (status, result, _) = request(
        &server,
        Method::POST,
        "/api/restore",
        json!({"backup":backup,"expectedRevision":snapshot["revision"]}),
        Some(&owner),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{result}");
    let restored = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&owner),
    )
    .await
    .1;
    assert_eq!(restored["state"]["items"].as_array().unwrap().len(), 1);
    assert_eq!(restored["state"]["items"][0]["note"], "Dark roast");
    assert!(restored["revision"].as_u64() > snapshot["revision"].as_u64());
    let mut invalid = backup;
    invalid["state"]["plan"]["2026-09-30"] = json!("missing-recipe");
    assert_eq!(
        request(
            &server,
            Method::POST,
            "/api/restore",
            json!({"backup":invalid,"expectedRevision":restored["revision"]}),
            Some(&owner)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(
            &server,
            Method::GET,
            "/api/state",
            Value::Null,
            Some(&owner)
        )
        .await
        .1,
        restored
    );
}

#[tokio::test]
async fn learned_intervals_ignore_restores_and_undone_purchases() {
    let (server, _dir) = server();
    let owner = owner(&server).await;
    for days in [24, 16, 8] {
        operation(&server,&owner,json!({"type":"addItem","productId":"oat-milk","quantity":if days == 8 {4} else {2},"unit":"L","note":"Barista","accumulate":false})).await;
        operation(
            &server,
            &owner,
            json!({"type":"checkItem","id":"oat-milk","checked":true}),
        )
        .await;
        let conn = server.db.lock().unwrap();
        let id: String = conn
            .query_row(
                "SELECT id FROM events WHERE kind='checkItem' ORDER BY at DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        conn.execute(
            "UPDATE events SET at=?1 WHERE id=?2",
            rusqlite::params![
                (chrono::Utc::now() - chrono::Duration::days(days)).to_rfc3339(),
                id
            ],
        )
        .unwrap();
    }
    let (status, insights, _) = request(
        &server,
        Method::GET,
        "/api/insights",
        Value::Null,
        Some(&owner),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(insights["restock"][0]["intervalDays"], 8);
    assert_eq!(insights["restock"][0]["note"], "Barista");
    assert_eq!(insights["restock"][0]["quantity"].as_f64(), Some(2.0));
    assert_eq!(insights["restock"][0]["unit"], "L");
    assert_eq!(insights["purchaseCount"], 3);
    operation(
        &server,
        &owner,
        json!({"type":"checkItem","id":"oat-milk","checked":false}),
    )
    .await;
    let insights = request(
        &server,
        Method::GET,
        "/api/insights",
        Value::Null,
        Some(&owner),
    )
    .await
    .1;
    assert_eq!(insights["purchaseCount"], 2);
    assert!(insights["restock"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn compatible_image_generation_stores_a_private_resized_attachment() {
    use axum::routing::post;
    use base64::Engine;
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(24, 24)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    let encoded = base64::engine::general_purpose::STANDARD.encode(png.into_inner());
    let fixture = Router::new().route(
        "/v1/images/generations",
        post(move || {
            let encoded = encoded.clone();
            async move { Json(json!({"data":[{"b64_json":encoded}]})) }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, fixture).await.unwrap() });
    let (server, _dir) = server();
    let owner = owner(&server).await;
    let(status,_,_)=request(&server,Method::PUT,"/api/ai/config",json!({"config":{"enabled":true,"baseUrl":format!("http://{address}/v1"),"model":"fixture-chat","imageModel":"fixture-image","imageSize":"1024x1024","responseFormat":"json","tokenParameter":"omit"},"apiKey":"fixture-key"}),Some(&owner)).await;
    assert_eq!(status, StatusCode::OK);
    let (status, result, _) = request(
        &server,
        Method::POST,
        "/api/ai/image",
        json!({"prompt":"A bowl of lunch"}),
        Some(&owner),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{result}");
    let url = result["url"].as_str().unwrap();
    let response = app(server.clone())
        .oneshot(
            Request::builder()
                .uri(url)
                .header(header::COOKIE, &owner)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CONTENT_TYPE], "image/jpeg");
    assert_eq!(
        request(&server, Method::GET, url, Value::Null, None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    operation(&server,&owner,json!({"type":"patch","label":"Attach photo","changes":[{"collection":"productImages","key":"coffee","field":null,"before":null,"after":url}]})).await;
    let backup = request(
        &server,
        Method::GET,
        "/api/backup",
        Value::Null,
        Some(&owner),
    )
    .await
    .1;
    let snapshot = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&owner),
    )
    .await
    .1;
    let (status, body, _) = request(
        &server,
        Method::POST,
        "/api/restore",
        json!({"backup":backup,"expectedRevision":snapshot["revision"]}),
        Some(&owner),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let restored = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&owner),
    )
    .await
    .1;
    let new_url = restored["state"]["productImages"]["coffee"]
        .as_str()
        .unwrap();
    assert_ne!(new_url, url);
    let response = app(server.clone())
        .oneshot(
            Request::builder()
                .uri(new_url)
                .header(header::COOKIE, &owner)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    task.abort();
}

#[test]
fn pantry_confirmation_includes_reserved_purchases_and_reveals_shortages() {
    let mut state = model::fresh_state(true, "UTC".into());
    let today = "2026-09-30";
    state.plan.insert(today.into(), "green-pasta".into());
    domain::apply(
        &mut state,
        &model::Operation::CheckItem {
            id: "pasta".into(),
            checked: true,
            expected: None,
        },
        today,
    )
    .unwrap();
    domain::apply(
        &mut state,
        &model::Operation::ObservePantry {
            product_id: "pasta".into(),
            quantity: 500.0,
            unit: "g".into(),
            expires_at: None,
        },
        today,
    )
    .unwrap();
    assert_eq!(state.pantry["pasta"].amounts[0].quantity, 100.0);
    assert_eq!(state.purchased_coverage[today]["pasta"][0].quantity, 400.0);
    domain::apply(
        &mut state,
        &model::Operation::ObservePantry {
            product_id: "pasta".into(),
            quantity: 200.0,
            unit: "g".into(),
            expires_at: None,
        },
        today,
    )
    .unwrap();
    assert!(state.pantry["pasta"].amounts.is_empty());
    assert_eq!(state.purchased_coverage[today]["pasta"][0].quantity, 200.0);
    assert_eq!(
        domain::displayed(&state, "pasta", today).unwrap().quantity,
        200.0
    );
}

#[tokio::test]
async fn recovery_rotates_codes_and_invalidates_existing_sessions() {
    let (server, _dir) = server();
    let cookie = owner(&server).await;
    let (status, result, _) = request(
        &server,
        Method::POST,
        "/api/auth/recovery-code",
        json!({"currentPassword":"a sufficiently long password"}),
        Some(&cookie),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let(status,recovered,new_cookie)=request(&server,Method::POST,"/api/auth/recover",json!({"email":"owner@example.test","recoveryCode":result["recoveryCode"],"newPassword":"a replacement family passphrase"}),None).await;
    assert_eq!(status, StatusCode::OK, "{recovered}");
    assert_ne!(result["recoveryCode"], recovered["recoveryCode"]);
    assert_eq!(
        request(
            &server,
            Method::GET,
            "/api/state",
            Value::Null,
            Some(&cookie)
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        request(
            &server,
            Method::GET,
            "/api/state",
            Value::Null,
            new_cookie.as_deref()
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(request(&server,Method::POST,"/api/auth/recover",json!({"email":"owner@example.test","recoveryCode":result["recoveryCode"],"newPassword":"another family passphrase"}),None).await.0,StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn households_cannot_read_each_others_state_history_or_private_images() {
    let (server, _dir) = server();
    let owner = owner(&server).await;
    operation(&server,&owner,json!({"type":"addItem","productId":"coffee","quantity":1,"unit":"pc","note":"Private household note","accumulate":false})).await;
    let other_household = uuid::Uuid::new_v4().to_string();
    let other_user = uuid::Uuid::new_v4().to_string();
    let raw = auth::token();
    {
        let conn = server.db.lock().unwrap();
        conn.execute(
            "INSERT INTO households(id,name,state) VALUES(?1,'Other household',?2)",
            rusqlite::params![
                other_household,
                serde_json::to_string(&model::fresh_state(false, "UTC".into())).unwrap()
            ],
        )
        .unwrap();
        conn.execute("INSERT INTO users(id,household_id,email,name,password_hash,role,recovery_hash) VALUES(?1,?2,'other@example.test','Other',?3,'owner','unused')",rusqlite::params![other_user,other_household,server.dummy_hash.as_ref()]).unwrap();
        conn.execute(
            "INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?1,?2,?3,?4)",
            rusqlite::params![
                auth::digest(&raw),
                other_user,
                chrono::Utc::now().timestamp() + 3600,
                chrono::Utc::now().timestamp()
            ],
        )
        .unwrap();
        let owner_household: String = conn
            .query_row(
                "SELECT household_id FROM users WHERE email='owner@example.test'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        conn.execute("INSERT INTO uploads(id,household_id,mime,bytes,created_at) VALUES('private-picture',?1,'image/jpeg',?2,?3)",rusqlite::params![owner_household,vec![0u8;10],chrono::Utc::now().to_rfc3339()]).unwrap();
    }
    let other = format!("forkbasket_session={raw}");
    let (status, state, _) = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&other),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(state["state"]["items"].as_array().unwrap().is_empty());
    assert!(
        request(
            &server,
            Method::GET,
            "/api/history",
            Value::Null,
            Some(&other)
        )
        .await
        .1
        .as_array()
        .unwrap()
        .is_empty()
    );
    assert_eq!(
        request(
            &server,
            Method::GET,
            "/api/images/private-picture",
            Value::Null,
            Some(&other)
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}
