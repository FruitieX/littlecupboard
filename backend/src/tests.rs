use super::*;
use axum::{
    body::Body,
    http::{Method, Request, header},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

#[tokio::test]
async fn static_shell_updates_with_reproducible_mtimes_and_private_apis_stay_uncached() {
    let (server, _db_dir) = server();
    let directory = tempfile::tempdir().unwrap();
    std::fs::create_dir(directory.path().join("assets")).unwrap();
    for (path, text) in [
        ("_shell.html", "<html>First release</html>"),
        ("sw.js", "// first worker"),
        ("manifest.webmanifest", "{}"),
        ("assets/app-abcd1234.js", "console.log('release');"),
    ] {
        let file = directory.path().join(path);
        std::fs::write(&file, text).unwrap();
        std::fs::File::open(&file)
            .unwrap()
            .set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(1))
            .unwrap();
    }
    let router = static_frontend(app(server), directory.path().to_str().unwrap());
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/settings/items")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-cache");
    let modified = response.headers()[header::LAST_MODIFIED].clone();
    let file = directory.path().join("_shell.html");
    std::fs::write(&file, "<html>Newer release</html>").unwrap();
    std::fs::File::open(&file)
        .unwrap()
        .set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(1))
        .unwrap();
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/settings/items")
                .header(header::IF_MODIFIED_SINCE, modified)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .as_ref(),
        b"<html>Newer release</html>"
    );
    for (path, expected) in [
        ("/sw.js", "no-store"),
        ("/manifest.webmanifest", "no-cache"),
        (
            "/assets/app-abcd1234.js",
            "public, max-age=31536000, immutable",
        ),
        ("/assets/missing.js", "no-cache"),
        ("/api/state", "no-store"),
    ] {
        let response = router
            .clone()
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(
            response.headers()[header::CACHE_CONTROL],
            expected,
            "{path}"
        );
        if path == "/api/state" {
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        }
    }
}

#[test]
fn system_prompts_use_defaults_for_missing_null_and_blank_fields() {
    let defaults = ai::SystemPrompts::default();
    for value in [
        Value::Null,
        json!({}),
        json!({"assistant":null,"itemImage":" \n\t","recipeImage":""}),
    ] {
        let prompts: ai::SystemPrompts = serde_json::from_value(value).unwrap();
        assert_eq!(prompts, defaults);
    }
    let custom = "  My household instructions.\nUse metric units.  ";
    let prompts: ai::SystemPrompts = serde_json::from_value(json!({"assistant":custom})).unwrap();
    assert_eq!(prompts.assistant, custom);
    assert_eq!(prompts.item_image, defaults.item_image);
    assert_eq!(prompts.recipe_image, defaults.recipe_image);
    for value in [
        json!({"itemImage":42}),
        json!({"itemimage":"typo"}),
        json!([]),
    ] {
        assert!(serde_json::from_value::<ai::SystemPrompts>(value).is_err());
    }
}

#[test]
fn rebrand_updates_only_legacy_default_prompts() {
    let defaults = ai::SystemPrompts::default();
    let legacy = serde_json::to_value(&defaults)
        .unwrap()
        .to_string()
        .replace("LittleCupboard", "ForkBasket");
    let upgraded: ai::SystemPrompts = serde_json::from_str(&legacy).unwrap();
    assert_eq!(upgraded, defaults);
    let custom = "You are ForkBasket. My custom family instructions.";
    let preserved: ai::SystemPrompts = serde_json::from_value(json!({"assistant":custom})).unwrap();
    assert_eq!(preserved.assistant, custom);
}

#[tokio::test]
async fn legacy_origin_and_header_can_sync_but_other_origins_are_rejected() {
    let (mut server, _dir) = server();
    Arc::get_mut(&mut server.config)
        .unwrap()
        .legacy_origins
        .push("https://forkbasket.fruitiex.org".into());
    let cookie = owner(&server).await;
    for (origin, expected) in [
        ("https://forkbasket.fruitiex.org", StatusCode::OK),
        ("https://other.example", StatusCode::FORBIDDEN),
    ] {
        let request = Request::builder().method(Method::POST).uri("/api/operations")
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::COOKIE, &cookie).header(header::ORIGIN, origin)
            .header("x-forkbasket-request", "1")
            .body(Body::from(json!({"id":uuid::Uuid::new_v4().to_string(),"operation":{"type":"addItem","productId":"coffee","quantity":1,"unit":"pack","note":"Legacy queue","accumulate":true}}).to_string())).unwrap();
        assert_eq!(
            app(server.clone()).oneshot(request).await.unwrap().status(),
            expected
        );
    }
    let mut backup = request(
        &server,
        Method::GET,
        "/api/backup",
        Value::Null,
        Some(&cookie),
    )
    .await
    .1;
    assert_eq!(backup["format"], "littlecupboard-household-v1");
    backup["format"] = json!("forkbasket-household-v1");
    let snapshot = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&cookie),
    )
    .await
    .1;
    let (status, result, _) = request(
        &server,
        Method::POST,
        "/api/restore",
        json!({"backup":backup,"expectedRevision":snapshot["revision"]}),
        Some(&cookie),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{result}");
}

#[tokio::test]
async fn legacy_prompt_settings_and_companion_icons_keep_their_defaults_and_credentials() {
    use base64::Engine;
    let (server, _dir) = server();
    let cookie = owner(&server).await;
    let household: String = server
        .db
        .lock()
        .unwrap()
        .query_row("SELECT id FROM households", [], |row| row.get(0))
        .unwrap();
    let pairing = ai::provision_companion(&server, &household, "gpt-6-luna", "xhigh").unwrap();
    let headers = worker_headers(pairing["token"].as_str().unwrap());
    let _ = companion::heartbeat(axum::extract::State(server.clone()), headers.clone())
        .await
        .unwrap();
    let (_, initial, _) = request(
        &server,
        Method::GET,
        "/api/ai/config",
        Value::Null,
        Some(&cookie),
    )
    .await;
    let defaults = initial["promptDefaults"].clone();
    let secret: String = server
        .db
        .lock()
        .unwrap()
        .query_row("SELECT secret FROM providers", [], |row| row.get(0))
        .unwrap();
    for override_value in [
        None,
        Some(Value::Null),
        Some(json!({})),
        Some(json!({"assistant":"","itemImage":" \n","recipeImage":null})),
        Some(json!({"assistant":"Custom assistant instructions."})),
    ] {
        let mut config = initial["config"].clone();
        match override_value {
            Some(value) => {
                config["prompts"] = value;
            }
            None => {
                config.as_object_mut().unwrap().remove("prompts");
            }
        }
        server
            .db
            .lock()
            .unwrap()
            .execute("UPDATE providers SET config=?1", [config.to_string()])
            .unwrap();
        let (status, loaded, _) = request(
            &server,
            Method::GET,
            "/api/ai/config",
            Value::Null,
            Some(&cookie),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{loaded}");
        assert_eq!(
            loaded["config"]["prompts"]["itemImage"],
            defaults["itemImage"]
        );
        assert_eq!(
            loaded["config"]["prompts"]["recipeImage"],
            defaults["recipeImage"]
        );
        assert_eq!(
            loaded["config"]["prompts"]["assistant"],
            if config["prompts"]["assistant"] == "Custom assistant instructions." {
                json!("Custom assistant instructions.")
            } else {
                defaults["assistant"].clone()
            }
        );
        assert_eq!(loaded["companion"]["paired"], true);
        assert_eq!(loaded["hasKey"], false);
        assert_eq!(
            server
                .db
                .lock()
                .unwrap()
                .query_row("SELECT secret FROM providers", [], |row| row
                    .get::<_, String>(0))
                .unwrap(),
            secret
        );
    }
    // Default text edited only for whitespace still receives the existing icon style sheet.
    let mut config = initial["config"].clone();
    config["prompts"] =
        json!({"itemImage": format!(" {}\n", defaults["itemImage"].as_str().unwrap())});
    let (status, saved, _) = request(
        &server,
        Method::PUT,
        "/api/ai/config",
        json!({"config":config,"apiKey":null}),
        Some(&cookie),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(
        saved["config"]["prompts"]["assistant"],
        defaults["assistant"]
    );
    let renderer = server.clone();
    let waiting = tokio::spawn(async move {
        ai::render_image(&renderer, &household, ai::ImageKind::Item, "Pear").await
    });
    let job = wait_for_companion_job(&server, &headers).await;
    assert_eq!(job["path"], "images/generations");
    let body = &job["body"];
    assert!(
        body["prompt"]
            .as_str()
            .unwrap()
            .contains(defaults["itemImage"].as_str().unwrap())
    );
    assert!(
        !body["prompt"]
            .as_str()
            .unwrap()
            .contains(defaults["recipeImage"].as_str().unwrap())
    );
    assert_eq!(body["background"], "transparent");
    assert_eq!(body["output_format"], "png");
    assert_eq!(body["size"], "816x816");
    assert!(
        body["reference_images"][0]
            .as_str()
            .unwrap()
            .starts_with("data:image/png;base64,")
    );
    let mut image = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(image::RgbaImage::new(32, 32))
        .write_to(&mut image, image::ImageFormat::Png)
        .unwrap();
    let _ = companion::complete(axum::extract::State(server.clone()), headers, Json(companion::Completion {
        id: job["id"].as_str().unwrap().into(), lease: job["lease"].as_str().unwrap().into(), failed:false,
        result:Some(json!({"data":[{"b64_json":base64::engine::general_purpose::STANDARD.encode(image.get_ref())}]})),
    })).await.unwrap();
    assert_eq!(waiting.await.unwrap().unwrap().mime, "image/webp");
}

#[tokio::test]
async fn item_icons_are_opt_in_durable_deduplicated_private_and_retryable() {
    use axum::{Json, routing::post};
    use base64::Engine;
    use std::sync::atomic::{AtomicBool, Ordering};
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(image::RgbaImage::from_fn(512, 512, |x, _| {
        if x < 50 {
            image::Rgba([0, 0, 0, 0])
        } else {
            image::Rgba([255, 100, 0, 255])
        }
    }))
    .write_to(&mut png, image::ImageFormat::Png)
    .unwrap();
    let encoded = base64::engine::general_purpose::STANDARD.encode(png.get_ref());
    let failing = Arc::new(AtomicBool::new(false));
    let calls = Arc::new(Mutex::new(Vec::<Value>::new()));
    let fail = failing.clone();
    let received = calls.clone();
    let fixture = Router::new().route(
        "/v1/images/generations",
        post(move |Json(body): Json<Value>| {
            received.lock().unwrap().push(body);
            let fail = fail.swap(false, Ordering::SeqCst);
            let encoded = encoded.clone();
            async move {
                if fail {
                    (StatusCode::TOO_MANY_REQUESTS, Json(json!({})))
                } else {
                    (StatusCode::OK, Json(json!({"data":[{"b64_json":encoded}]})))
                }
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, fixture).await.unwrap() });
    let (server, dir) = server();
    let owner = owner(&server).await;
    let mut config = json!({"enabled":true,"baseUrl":format!("http://{address}/v1"),"model":"fixture-chat","imageModel":"gpt-image-2","imageSize":"1024x1024","responseFormat":"json","tokenParameter":"omit"});
    let (_, saved, _) = request(
        &server,
        Method::PUT,
        "/api/ai/config",
        json!({"config":config,"apiKey":"fixture"}),
        Some(&owner),
    )
    .await;
    assert_eq!(saved["config"]["autoItemIcons"], false);
    // Give pre-existing catalog placeholders artwork so this fixture's bulk
    // batch contains just the newly created missing item.
    let existing: Vec<_> = domain::products(&model::fresh_state(true,"UTC".into()),false).into_iter().filter(crate::icon_jobs::missing_icon).map(|product|json!({"collection":"productImages","key":product.id,"field":null,"before":null,"after":"/images/pasta.jpg"})).collect();
    assert_eq!(
        operation(
            &server,
            &owner,
            json!({"type":"patch","label":"Existing catalog artwork","changes":existing})
        )
        .await
        .0,
        StatusCode::OK
    );
    for (id, icon) in [("custom-missing", "🛒"), ("custom-emoji", "🍎")] {
        assert_eq!(operation(&server,&owner,json!({"type":"patch","label":"Create item","changes":[{"collection":"customProducts","key":id,"field":null,"before":null,"after":{"id":id,"name":id,"category":"Fruits","icon":icon}}]})).await.0,StatusCode::OK);
    }
    assert!(
        !crate::icon_jobs::run_one(&server).await.unwrap(),
        "Generation is off by default"
    );
    let (_, jobs, _) = request(
        &server,
        Method::GET,
        "/api/ai/item-icons",
        Value::Null,
        Some(&owner),
    )
    .await;
    assert_eq!(jobs["missing"], 1);
    assert_eq!(jobs["queued"], 0);
    for _ in 0..2 {
        assert_eq!(
            request(
                &server,
                Method::POST,
                "/api/ai/item-icons",
                json!({"action":"generate"}),
                Some(&owner)
            )
            .await
            .0,
            StatusCode::OK
        );
    }
    let reopened = db::Database::open(&dir.path().join("test.sqlite3")).unwrap();
    assert_eq!(
        reopened
            .lock()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM item_icon_jobs WHERE status='queued'",
                [],
                |row| row.get::<_, u32>(0)
            )
            .unwrap(),
        1
    );
    drop(reopened);
    failing.store(true, Ordering::SeqCst);
    assert!(crate::icon_jobs::run_one(&server).await.unwrap());
    assert!(
        !crate::icon_jobs::run_one(&server).await.unwrap(),
        "Provider failures must not retry automatically"
    );
    let (_, jobs, _) = request(
        &server,
        Method::GET,
        "/api/ai/item-icons",
        Value::Null,
        Some(&owner),
    )
    .await;
    assert_eq!(jobs["failed"], 1);
    request(
        &server,
        Method::POST,
        "/api/ai/item-icons",
        json!({"action":"retry"}),
        Some(&owner),
    )
    .await;
    assert!(crate::icon_jobs::run_one(&server).await.unwrap());
    let (_, snapshot, _) = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&owner),
    )
    .await;
    let url = snapshot["state"]["productImages"]["custom-missing"]
        .as_str()
        .unwrap();
    assert!(snapshot["state"]["productImages"]["custom-emoji"].is_null());
    assert!(snapshot["state"]["productImages"]["apples"].is_null());
    let household = server
        .db
        .lock()
        .unwrap()
        .query_row("SELECT id FROM households", [], |row| {
            row.get::<_, String>(0)
        })
        .unwrap();
    let bytes: Vec<u8> = server
        .db
        .lock()
        .unwrap()
        .query_row(
            "SELECT bytes FROM uploads WHERE household_id=?1 AND id=?2",
            rusqlite::params![household, url.trim_start_matches("/api/images/")],
            |row| row.get(0),
        )
        .unwrap();
    let decoded = image::load_from_memory(&bytes).unwrap().into_rgba8();
    assert_eq!(decoded.dimensions(), (256, 256));
    assert_eq!(decoded.get_pixel(0, 0)[3], 0);
    assert_eq!(
        request(&server, Method::GET, url, Value::Null, None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert!(
        calls
            .lock()
            .unwrap()
            .iter()
            .all(|body| body["background"] == "transparent"
                && body["size"] == "816x816"
                && body["prompt"].as_str().unwrap().contains("Twemoji"))
    );
    config["autoItemIcons"] = json!(true);
    request(
        &server,
        Method::PUT,
        "/api/ai/config",
        json!({"config":config}),
        Some(&owner),
    )
    .await;
    let mutation = json!({"id":uuid::Uuid::new_v4().to_string(),"operation":{"type":"patch","label":"Create automatic item","changes":[{"collection":"customProducts","key":"custom-auto","field":null,"before":null,"after":{"id":"custom-auto","name":"Automatic item","category":"Fruits","icon":"🛒"}}]}});
    for _ in 0..2 {
        assert_eq!(
            request(
                &server,
                Method::POST,
                "/api/operations",
                mutation.clone(),
                Some(&owner)
            )
            .await
            .0,
            StatusCode::OK
        );
    }
    let (_, jobs, _) = request(
        &server,
        Method::GET,
        "/api/ai/item-icons",
        Value::Null,
        Some(&owner),
    )
    .await;
    assert_eq!(jobs["queued"], 1);
    {
        let conn = server.db.lock().unwrap();
        for number in 0..20 {
            conn.execute(
                "INSERT INTO item_icon_attempts(id,household_id) VALUES(?1,?2)",
                rusqlite::params![format!("pace-{number}"), household],
            )
            .unwrap();
        }
    }
    assert!(
        !crate::icon_jobs::run_one(&server).await.unwrap(),
        "A full hourly budget keeps the remaining work queued"
    );
    {
        let conn = server.db.lock().unwrap();
        conn.execute(
            "UPDATE item_icon_attempts SET started_at=unixepoch()-3601 WHERE id LIKE 'pace-%'",
            [],
        )
        .unwrap();
        conn.execute("UPDATE item_icon_jobs SET status='running',run_id='interrupted' WHERE product_id='custom-auto'",[]).unwrap();
    }
    crate::icon_jobs::resume_interrupted(&server).unwrap();
    request(
        &server,
        Method::POST,
        "/api/ai/item-icons",
        json!({"action":"generate"}),
        Some(&owner),
    )
    .await;
    config["autoItemIcons"] = json!(false);
    request(
        &server,
        Method::PUT,
        "/api/ai/config",
        json!({"config":config}),
        Some(&owner),
    )
    .await;
    assert_eq!(
        request(
            &server,
            Method::GET,
            "/api/ai/item-icons",
            Value::Null,
            Some(&owner)
        )
        .await
        .1["queued"],
        1,
        "A manual batch adopts queued automatic work and survives switching auto off"
    );
    // A partner can create missing items but cannot spend quota on bulk jobs.
    let (_, invite, _) = request(
        &server,
        Method::POST,
        "/api/invitations",
        json!({"email":"wife@example.test"}),
        Some(&owner),
    )
    .await;
    let token = invite["url"]
        .as_str()
        .unwrap()
        .split("invite=")
        .nth(1)
        .unwrap();
    let (_,_,wife)=request(&server,Method::POST,"/api/auth/join",json!({"token":token,"email":"wife@example.test","name":"Wife","password":"another good long password"}),None).await;
    for method in [Method::GET, Method::POST] {
        assert_eq!(
            request(
                &server,
                method,
                "/api/ai/item-icons",
                json!({"action":"generate"}),
                wife.as_deref()
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
    }
    assert!(crate::icon_jobs::run_one(&server).await.unwrap());
    let (_, shared, _) = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        wife.as_deref(),
    )
    .await;
    assert!(
        shared["state"]["productImages"]["custom-auto"]
            .as_str()
            .is_some()
    );
    config["autoItemIcons"] = json!(false);
    request(
        &server,
        Method::PUT,
        "/api/ai/config",
        json!({"config":config}),
        Some(&owner),
    )
    .await;
    task.abort();
}

#[tokio::test]
async fn background_icons_do_not_overwrite_edits_or_apply_after_canceling() {
    use axum::{Json, routing::post};
    use base64::Engine;
    let started = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgba8(32, 32)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    let encoded = base64::engine::general_purpose::STANDARD.encode(png.get_ref());
    let begin = started.clone();
    let gate = release.clone();
    let fixture = Router::new().route(
        "/v1/images/generations",
        post(move || {
            let begin = begin.clone();
            let gate = gate.clone();
            let encoded = encoded.clone();
            async move {
                begin.notify_one();
                gate.notified().await;
                Json(json!({"data":[{"b64_json":encoded}]}))
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, fixture).await.unwrap() });
    let (server, _dir) = server();
    let owner = owner(&server).await;
    let mut config = json!({"enabled":true,"autoItemIcons":true,"baseUrl":format!("http://{address}/v1"),"model":"fixture-chat","imageModel":"gpt-image-2","imageSize":"1024x1024","responseFormat":"json","tokenParameter":"omit"});
    for action in ["upload", "delete", "archive", "cancel", "disable", "rename"] {
        config["autoItemIcons"] = json!(true);
        request(
            &server,
            Method::PUT,
            "/api/ai/config",
            json!({"config":config,"apiKey":"fixture"}),
            Some(&owner),
        )
        .await;
        let product = json!({"id":format!("custom-{action}"),"name":format!("Item {action}"),"category":"Fruits","icon":"🛒"});
        let id = product["id"].as_str().unwrap();
        assert_eq!(operation(&server,&owner,json!({"type":"patch","label":"Create item","changes":[{"collection":"customProducts","key":id,"field":null,"before":null,"after":product}]})).await.0,StatusCode::OK);
        let runner = server.clone();
        let generation =
            tokio::spawn(async move { crate::icon_jobs::run_one(&runner).await.unwrap() });
        tokio::time::timeout(std::time::Duration::from_secs(5), started.notified())
            .await
            .unwrap();
        let change = match action {
            "upload" => Some(
                json!({"collection":"productImages","key":id,"field":null,"before":null,"after":"/images/pasta.jpg"}),
            ),
            "delete" => {
                let (_, snapshot, _) = request(
                    &server,
                    Method::GET,
                    "/api/state",
                    Value::Null,
                    Some(&owner),
                )
                .await;
                let stored = snapshot["state"]["customProducts"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|entry| entry["id"] == id)
                    .unwrap();
                Some(
                    json!({"collection":"customProducts","key":id,"field":null,"before":stored,"after":null}),
                )
            }
            "archive" => Some(
                json!({"collection":"archivedProductIds","key":"","field":null,"before":[],"after":[id]}),
            ),
            "rename" => Some(
                json!({"collection":"customProducts","key":id,"field":"name","before":product["name"],"after":"Changed item"}),
            ),
            _ => None,
        };
        if let Some(change) = change {
            assert_eq!(
                operation(
                    &server,
                    &owner,
                    json!({"type":"patch","label":"Edit while generating","changes":[change]})
                )
                .await
                .0,
                StatusCode::OK
            );
        }
        if action == "cancel" {
            request(
                &server,
                Method::POST,
                "/api/ai/item-icons",
                json!({"action":"cancel"}),
                Some(&owner),
            )
            .await;
        }
        if action == "disable" {
            config["autoItemIcons"] = json!(false);
            request(
                &server,
                Method::PUT,
                "/api/ai/config",
                json!({"config":config}),
                Some(&owner),
            )
            .await;
        }
        release.notify_one();
        assert!(generation.await.unwrap());
        let (_, snapshot, _) = request(
            &server,
            Method::GET,
            "/api/state",
            Value::Null,
            Some(&owner),
        )
        .await;
        assert_eq!(
            snapshot["state"]["productImages"][id],
            if action == "upload" {
                json!("/images/pasta.jpg")
            } else {
                Value::Null
            },
            "{action}"
        );
    }
    assert_eq!(
        server
            .db
            .lock()
            .unwrap()
            .query_row("SELECT count(*) FROM uploads", [], |row| row
                .get::<_, u32>(0))
            .unwrap(),
        0,
        "Discarded generation must not leak unused uploads"
    );
    task.abort();
}

#[test]
fn restoring_a_purchase_removes_pantry_stock_including_released_meal_surplus() {
    let today = "2026-10-01";
    for scenario in ["manual", "planned", "released"] {
        let mut state = model::fresh_state(true, "UTC".into());
        let id = if scenario == "manual" {
            "cherry-tomatoes"
        } else {
            "pasta"
        };
        let quantity = if scenario == "manual" { 2.0 } else { 800.0 };
        let unit = if scenario == "manual" { "pc" } else { "g" };
        if scenario != "manual" {
            state.plan.insert(today.into(), "green-pasta".into());
        }
        domain::apply(
            &mut state,
            &model::Operation::AddItem {
                product_id: id.into(),
                quantity,
                unit: unit.into(),
                note: "Keep this note".into(),
                accumulate: false,
            },
            today,
        )
        .unwrap();
        domain::apply(
            &mut state,
            &model::Operation::CheckItem {
                id: id.into(),
                checked: true,
                expected: None,
            },
            today,
        )
        .unwrap();
        assert!(state.pantry.contains_key(id));
        if scenario == "released" {
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
            assert_eq!(state.pantry[id].amounts[0].quantity, 800.0);
        }
        let expected = domain::displayed(&state, id, today).unwrap();
        assert!(expected.checked);
        domain::apply(
            &mut state,
            &model::Operation::CheckItem {
                id: id.into(),
                checked: false,
                expected: Some(Box::new(expected)),
            },
            today,
        )
        .unwrap();
        assert!(!state.pantry.contains_key(id), "{scenario}");
        assert!(
            state
                .purchased_coverage
                .values()
                .all(|products| products.get(id).is_none_or(|amounts| amounts.is_empty()))
        );
        let restored = domain::displayed(&state, id, today).unwrap();
        assert!(!restored.checked);
        assert_eq!(restored.note, "Keep this note");
        let mut reloaded: model::HouseholdState =
            serde_json::from_str(&serde_json::to_string(&state).unwrap()).unwrap();
        domain::apply(
            &mut reloaded,
            &model::Operation::Patch {
                label: "Change a setting".into(),
                changes: vec![],
            },
            today,
        )
        .unwrap();
        assert!(!reloaded.pantry.contains_key(id));
        if scenario == "released" {
            reloaded.plan.insert(today.into(), "green-pasta".into());
            assert!(
                domain::outstanding(&reloaded, today)
                    .iter()
                    .any(|credit| credit.product_id == id)
            );
        }
    }
}

#[test]
fn pantry_removal_accepts_the_same_whole_number_serialized_by_a_browser() {
    let mut state = model::fresh_state(false, "UTC".into());
    state.pantry.insert(
        "cherry-tomatoes".into(),
        model::PantryItem {
            amounts: vec![model::Amount {
                quantity: 2.0,
                unit: "pc".into(),
            }],
            confirmed: false,
            observed_at: "2026-10-01T12:00:00+00:00".into(),
            expires_at: None,
            note: "".into(),
        },
    );
    let before = json!({"amounts":[{"quantity":2,"unit":"pc"}],"confirmed":false,"observedAt":"2026-10-01T12:00:00+00:00","expiresAt":null,"note":""});
    let change = model::Change {
        collection: "pantry".into(),
        key: "cherry-tomatoes".into(),
        field: None,
        before,
        after: Value::Null,
    };
    domain::apply_changes(&mut state, &[change]).unwrap();
    assert!(!state.pantry.contains_key("cherry-tomatoes"));
}

#[test]
fn browser_number_comparison_preserves_actual_conflicts_and_large_integer_precision() {
    assert!(domain::json_equal(
        &json!({"quantity": 2.0, "nested":[1.0,0.5]}),
        &json!({"quantity":2,"nested":[1,0.5]})
    ));
    assert!(!domain::json_equal(
        &json!({"quantity":2.0}),
        &json!({"quantity":3})
    ));
    assert!(!domain::json_equal(
        &json!(9007199254740993u64),
        &json!(9007199254740992.0)
    ));
    assert!(!domain::json_equal(
        &json!({"quantity":2}),
        &json!({"quantity":2,"note":null})
    ));
    let mut state = model::fresh_state(false, "UTC".into());
    state.pantry.insert(
        "cherry-tomatoes".into(),
        model::PantryItem {
            amounts: vec![model::Amount {
                quantity: 3.0,
                unit: "pc".into(),
            }],
            confirmed: true,
            observed_at: "2026-10-01T12:00:00+00:00".into(),
            expires_at: None,
            note: "".into(),
        },
    );
    let mut before = serde_json::to_value(&state.pantry["cherry-tomatoes"]).unwrap();
    before["amounts"][0]["quantity"] = json!(2);
    let changes = [model::Change {
        collection: "pantry".into(),
        key: "cherry-tomatoes".into(),
        field: None,
        before,
        after: Value::Null,
    }];
    assert!(domain::apply_changes(&mut state, &changes).is_err());
    assert_eq!(state.pantry["cherry-tomatoes"].amounts[0].quantity, 3.0);
}

#[tokio::test]
async fn household_catalog_overrides_are_validated_and_archives_keep_recipe_references() {
    let (server, _dir) = server();
    let cookie = owner(&server).await;
    let mut pasta = model::seed()
        .catalog
        .iter()
        .find(|product| product.id == "pasta")
        .cloned()
        .unwrap();
    pasta.name = "Family pasta".into();
    pasta.aliases = vec!["family noodles".into()];
    let details = serde_json::to_value(&pasta).unwrap();
    let (status, state) = operation(&server, &cookie, json!({"type":"patch","label":"Edit catalog","changes":[{"collection":"productDetails","key":"pasta","field":null,"before":null,"after":details},{"collection":"archivedProductIds","key":"","field":null,"before":[],"after":["pasta"]}]})).await;
    assert_eq!(status, StatusCode::OK, "{state}");
    let household: model::HouseholdState = serde_json::from_value(state["state"].clone()).unwrap();
    assert_eq!(
        domain::product(&household, "pasta").unwrap().name,
        "Family pasta"
    );
    assert!(
        !domain::products(&household, false)
            .iter()
            .any(|product| product.id == "pasta")
    );
    assert!(
        domain::products(&household, true)
            .iter()
            .any(|product| product.id == "pasta")
    );
    let invalid = operation(&server,&cookie,json!({"type":"patch","label":"Invalid edit","changes":[{"collection":"productDetails","key":"missing-product","field":null,"before":null,"after":details}]})).await;
    assert_eq!(invalid.0, StatusCode::BAD_REQUEST);
    let stale = operation(&server,&cookie,json!({"type":"patch","label":"Stale edit","changes":[{"collection":"productDetails","key":"pasta","field":null,"before":null,"after":null}]})).await;
    assert_eq!(stale.0, StatusCode::CONFLICT);
    assert_eq!(
        request(
            &server,
            Method::GET,
            "/api/state",
            Value::Null,
            Some(&cookie)
        )
        .await
        .1["state"]["productDetails"]["pasta"]["name"],
        "Family pasta"
    );
}

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
    let job = wait_for_companion_job(&server, &headers).await;
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
        legacy_origins: vec![],
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
        .header("x-littlecupboard-request", "1")
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
            request = request.header("x-littlecupboard-request", "1");
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
    // 2 L, 2 L, then 4 L at a learned 2 L per 8 days: the larger last
    // purchase lasts 16 days, so it is used up by now and due again.
    for days in [32, 24, 16] {
        operation(&server,&owner,json!({"type":"addItem","productId":"oat-milk","quantity":if days == 16 {4} else {2},"unit":"L","note":"Barista","accumulate":false})).await;
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
    assert_eq!(
        insights["habits"][0]["estimatedConsumption"],
        json!({"quantity":2.0,"unit":"L","days":8.0})
    );
    assert_eq!(insights["habits"][0]["consumptionSource"], "estimated");
    assert_eq!(insights["restock"][0]["note"], "Barista");
    assert_eq!(insights["restock"][0]["quantity"].as_f64(), Some(2.0));
    assert_eq!(insights["restock"][0]["unit"], "L");
    assert_eq!(insights["restock"][0]["daysLeft"], 0.0);
    assert_eq!(insights["stock"][0]["status"], "out");
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
    assert_eq!(insights["habits"][0]["estimatedConsumption"], Value::Null);
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

#[tokio::test]
async fn durable_image_jobs_are_idempotent_recoverable_and_deliver_private_results() {
    use axum::routing::post;
    use base64::Engine;
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(24, 24)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    let encoded = base64::engine::general_purpose::STANDARD.encode(png.into_inner());
    let calls = std::sync::Arc::new(std::sync::Mutex::new(0u32));
    let image_calls = calls.clone();
    let fixture = Router::new().route(
        "/v1/images/generations",
        post(move |Json(_body): Json<Value>| {
            *image_calls.lock().unwrap() += 1;
            let encoded = encoded.clone();
            async move { Json(json!({"data":[{"b64_json":encoded}]})) }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, fixture).await.unwrap() });
    let (server, _dir) = server();
    let owner = owner(&server).await;
    let config = json!({"enabled":true,"baseUrl":format!("http://{address}/v1"),"model":"fixture-chat","imageModel":"fixture-image","imageSize":"1024x1024","responseFormat":"json","tokenParameter":"omit"});
    assert_eq!(
        request(
            &server,
            Method::PUT,
            "/api/ai/config",
            json!({"config":config,"apiKey":"fixture-key"}),
            Some(&owner)
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        request(
            &server,
            Method::POST,
            "/api/ai/jobs",
            json!({"kind":"item","prompt":"A pear"}),
            None
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    let body = json!({"requestId":"request-one","scope":"item:pear","kind":"item","prompt":"A pear","productId":"household-pear"});
    let (status, created, _) = request(
        &server,
        Method::POST,
        "/api/ai/jobs",
        body.clone(),
        Some(&owner),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{created}");
    assert_eq!(created["status"], "queued");
    let job_id = created["jobId"].as_str().unwrap().to_string();
    // A lost response retried with the same request id collects the job.
    let (_, retried, _) = request(&server, Method::POST, "/api/ai/jobs", body, Some(&owner)).await;
    assert_eq!(retried["jobId"], job_id);
    // An identical request while work is queued is adopted, not doubled.
    let (_, adopted, _) = request(
        &server,
        Method::POST,
        "/api/ai/jobs",
        json!({"requestId":"request-two","scope":"item:pear","kind":"item","prompt":"A pear","productId":"household-pear"}),
        Some(&owner),
    )
    .await;
    assert_eq!(adopted["jobId"], job_id);
    let count: i64 = server
        .db
        .lock()
        .unwrap()
        .query_row("SELECT count(*) FROM ai_image_jobs", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 1);
    // A dialog recovers queued work by scope, then the finished result.
    let (status, listed, _) = request(
        &server,
        Method::GET,
        "/api/ai/jobs?scope=item:pear",
        Value::Null,
        Some(&owner),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(listed["jobs"][0]["id"], job_id);
    assert_eq!(listed["jobs"][0]["status"], "queued");
    assert!(crate::image_jobs::run_one(&server).await.unwrap());
    assert!(!crate::image_jobs::run_one(&server).await.unwrap());
    let (_, finished, _) = request(
        &server,
        Method::GET,
        &format!("/api/ai/jobs?id={job_id}"),
        Value::Null,
        Some(&owner),
    )
    .await;
    assert_eq!(finished["jobs"][0]["status"], "done");
    let url = finished["jobs"][0]["url"].as_str().unwrap();
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
    assert_eq!(
        request(&server, Method::GET, url, Value::Null, None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(*calls.lock().unwrap(), 1);
    let (_, recovered, _) = request(
        &server,
        Method::GET,
        "/api/ai/jobs?scope=item:pear",
        Value::Null,
        Some(&owner),
    )
    .await;
    assert_eq!(recovered["jobs"][0]["status"], "done");
    assert_eq!(recovered["jobs"][0]["url"], url);
    task.abort();
}

#[tokio::test]
async fn image_job_failures_are_explicit_and_unavailable_work_waits_then_expires() {
    use axum::routing::post;
    let fixture = Router::new().route(
        "/v1/images/generations",
        post(|| async {
            (
                StatusCode::TOO_MANY_REQUESTS,
                Json(json!({"error":"quota"})),
            )
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, fixture).await.unwrap() });
    let (server, _dir) = server();
    let owner = owner(&server).await;
    let config = json!({"enabled":true,"baseUrl":format!("http://{address}/v1"),"model":"fixture-chat","imageModel":"fixture-image","imageSize":"1024x1024","responseFormat":"json","tokenParameter":"omit"});
    assert_eq!(
        request(
            &server,
            Method::PUT,
            "/api/ai/config",
            json!({"config":config,"apiKey":"fixture-key"}),
            Some(&owner)
        )
        .await
        .0,
        StatusCode::OK
    );
    let (_, created, _) = request(
        &server,
        Method::POST,
        "/api/ai/jobs",
        json!({"requestId":"failing-one","scope":"item:failing","kind":"item","prompt":"A lemon"}),
        Some(&owner),
    )
    .await;
    let failing = created["jobId"].as_str().unwrap().to_string();
    assert!(crate::image_jobs::run_one(&server).await.unwrap());
    let (_, view, _) = request(
        &server,
        Method::GET,
        &format!("/api/ai/jobs?id={failing}"),
        Value::Null,
        Some(&owner),
    )
    .await;
    assert_eq!(view["jobs"][0]["status"], "failed");
    assert_eq!(
        view["jobs"][0]["error"],
        "The provider is busy or its quota is exhausted. Try again later."
    );
    // Companion work waits while the personal agent is away instead of
    // failing instantly; overly old queued work expires with a clear reason.
    let companion = json!({"enabled":true,"transport":"companion","baseUrl":"http://127.0.0.1:9/v1","model":"fixture-chat","imageModel":"fixture-image","imageSize":"1024x1024","responseFormat":"json","tokenParameter":"omit"});
    assert_eq!(
        request(
            &server,
            Method::PUT,
            "/api/ai/config",
            json!({"config":companion,"apiKey":null}),
            Some(&owner)
        )
        .await
        .0,
        StatusCode::OK
    );
    let (_, waiting, _) = request(
        &server,
        Method::POST,
        "/api/ai/jobs",
        json!({"requestId":"waiting-one","scope":"item:waiting","kind":"item","prompt":"A plum"}),
        Some(&owner),
    )
    .await;
    let waiting_id = waiting["jobId"].as_str().unwrap().to_string();
    assert!(!crate::image_jobs::run_one(&server).await.unwrap());
    let (_, queued, _) = request(
        &server,
        Method::GET,
        &format!("/api/ai/jobs?id={waiting_id}"),
        Value::Null,
        Some(&owner),
    )
    .await;
    assert_eq!(queued["jobs"][0]["status"], "queued");
    server
        .db
        .lock()
        .unwrap()
        .execute(
            "UPDATE ai_image_jobs SET created_at=unixepoch()-2000 WHERE id=?1",
            rusqlite::params![waiting_id],
        )
        .unwrap();
    assert!(!crate::image_jobs::run_one(&server).await.unwrap());
    let (_, expired, _) = request(
        &server,
        Method::GET,
        &format!("/api/ai/jobs?id={waiting_id}"),
        Value::Null,
        Some(&owner),
    )
    .await;
    assert_eq!(expired["jobs"][0]["status"], "failed");
    assert_eq!(
        expired["jobs"][0]["error"],
        "The assistant was unavailable for too long. Try again."
    );
    task.abort();
}

#[tokio::test]
async fn durable_icon_sheet_jobs_deliver_icons_and_attach_proposal_images_server_side() {
    use axum::routing::post;
    use base64::Engine;
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(24, 24)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    let encoded = base64::engine::general_purpose::STANDARD.encode(png.into_inner());
    let calls = std::sync::Arc::new(std::sync::Mutex::new(0u32));
    let image_calls = calls.clone();
    let fixture = Router::new().route(
        "/v1/images/generations",
        post(move |Json(_body): Json<Value>| {
            *image_calls.lock().unwrap() += 1;
            let encoded = encoded.clone();
            async move { Json(json!({"data":[{"b64_json":encoded}]})) }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, fixture).await.unwrap() });
    let (server, _dir) = server();
    let owner = owner(&server).await;
    let config = json!({"enabled":true,"baseUrl":format!("http://{address}/v1"),"model":"fixture-chat","imageModel":"fixture-image","imageSize":"1024x1024","responseFormat":"json","tokenParameter":"omit"});
    assert_eq!(
        request(
            &server,
            Method::PUT,
            "/api/ai/config",
            json!({"config":config,"apiKey":"fixture-key"}),
            Some(&owner)
        )
        .await
        .0,
        StatusCode::OK
    );
    // A draft icon sheet recovers by scope and returns per-item icons.
    let (status, created, _) = request(&server,Method::POST,"/api/ai/jobs",json!({"requestId":"sheet-one","scope":"recipe:r1","kind":"sheet","items":[{"id":"draft-pear","name":"Pear","category":"Fruits"}]}),Some(&owner)).await;
    assert_eq!(status, StatusCode::OK, "{created}");
    assert!(crate::image_jobs::run_one(&server).await.unwrap());
    let (_, sheet, _) = request(
        &server,
        Method::GET,
        &format!("/api/ai/jobs?id={}", created["jobId"].as_str().unwrap()),
        Value::Null,
        Some(&owner),
    )
    .await;
    assert_eq!(sheet["jobs"][0]["status"], "done");
    assert_eq!(sheet["jobs"][0]["icons"][0]["id"], "draft-pear");
    let icon_url = sheet["jobs"][0]["icons"][0]["url"].as_str().unwrap();
    assert!(icon_url.starts_with("/api/images/"));
    assert_eq!(
        request(&server, Method::GET, icon_url, Value::Null, None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    // A picture for a proposal product attaches to the stored proposal so a
    // reopened assistant shows it without rerunning anything.
    let household: String = server
        .db
        .lock()
        .unwrap()
        .query_row("SELECT id FROM households", [], |row| row.get(0))
        .unwrap();
    let revision = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&owner),
    )
    .await
    .1["revision"]
        .as_u64()
        .unwrap();
    let proposal = json!({"id":"proposal-attach","message":"Try this","products":[{"id":"proposal-pear","name":"Pear","category":"Fruits","icon":"🛒","aliases":[]}],"shopping":[],"recipes":[],"plan":[],"baseRevision":revision});
    server
        .db
        .lock()
        .unwrap()
        .execute(
            "INSERT INTO ai_proposals(id,household_id,proposal,created_at) VALUES('proposal-attach',?1,?2,unixepoch())",
            rusqlite::params![household, proposal.to_string()],
        )
        .unwrap();
    let (_, attached, _) = request(&server,Method::POST,"/api/ai/jobs",json!({"requestId":"attach-one","kind":"item","proposalId":"proposal-attach","productId":"proposal-pear"}),Some(&owner)).await;
    assert_eq!(attached["status"], "queued");
    assert!(crate::image_jobs::run_one(&server).await.unwrap());
    let (_, job, _) = request(
        &server,
        Method::GET,
        &format!("/api/ai/jobs?id={}", attached["jobId"].as_str().unwrap()),
        Value::Null,
        Some(&owner),
    )
    .await;
    assert_eq!(job["jobs"][0]["status"], "done");
    let stored: String = server
        .db
        .lock()
        .unwrap()
        .query_row(
            "SELECT proposal FROM ai_proposals WHERE id='proposal-attach'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let stored: Value = serde_json::from_str(&stored).unwrap();
    assert_eq!(stored["products"][0]["image"], job["jobs"][0]["url"]);
    assert_eq!(*calls.lock().unwrap(), 2);
    task.abort();
}

#[tokio::test]
async fn recipe_vision_icon_alpha_and_generated_draft_photos_are_private_and_reviewed() {
    use axum::routing::post;
    use base64::Engine;
    let rgba = image::RgbaImage::from_fn(2048, 2048, |x, y| {
        if x < 200 || y < 200 {
            image::Rgba([0, 0, 0, 0])
        } else {
            image::Rgba([255, 80, 40, 255])
        }
    });
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(rgba)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    let encoded = base64::engine::general_purpose::STANDARD.encode(png.get_ref());
    let calls = std::sync::Arc::new(std::sync::Mutex::new(Vec::<Value>::new()));
    let chat_calls = calls.clone();
    let image_calls = calls.clone();
    let fixture = Router::new().route("/v1/chat/completions", post(move |Json(body):Json<Value>| {
        chat_calls.lock().unwrap().push(body);
        async { Json(json!({"choices":[{"message":{"content":json!({"message":"Transcribed. Review the notes.","shopping":[],"recipes":[{"name":"Screenshot recipe","subtitle":"## Notes\n\n**Keep chilled**.\n\n- Serve fresh","minutes":10,"servings":4,"tags":["Imported"],"ingredients":[{"name":"Synthetic truffle flakes","productId":null,"category":null,"quantity":80,"unit":"g","note":"As written"}],"steps":["Mix the ingredients.","Serve **fresh**."]}],"plan":[]}).to_string()}}]})) }
    })).route("/v1/images/generations",post(move |Json(body):Json<Value>| {
        image_calls.lock().unwrap().push(body);
        let encoded=encoded.clone();
        async move { Json(json!({"data":[{"b64_json":encoded}]})) }
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, fixture).await.unwrap() });
    let (server, _dir) = server();
    let owner = owner(&server).await;
    let household: String = server
        .db
        .lock()
        .unwrap()
        .query_row("SELECT id FROM households", [], |row| row.get(0))
        .unwrap();
    let mut multipart = b"--recipe-source\r\nContent-Disposition: form-data; name=\"image\"; filename=\"Family recipe.png\"\r\nContent-Type: image/png\r\n\r\n".to_vec();
    multipart.extend(png.get_ref());
    multipart.extend(b"\r\n--recipe-source--\r\n");
    let uploaded = app(server.clone())
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/images?source=true")
                .header(header::COOKIE, &owner)
                .header(header::ORIGIN, &server.config.origin)
                .header("x-littlecupboard-request", "1")
                .header(
                    header::CONTENT_TYPE,
                    "multipart/form-data; boundary=recipe-source",
                )
                .body(Body::from(multipart))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(uploaded.status(), StatusCode::OK);
    let upload: Value =
        serde_json::from_slice(&uploaded.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(
        request(
            &server,
            Method::GET,
            upload["url"].as_str().unwrap(),
            Value::Null,
            None
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    let config = json!({"enabled":true,"baseUrl":format!("http://{address}/v1"),"model":"fixture-chat","imageModel":"gpt-image-2","imageSize":"1024x1024","responseFormat":"schema","tokenParameter":"omit","prompts":{"assistant":"Use metric quantities and concise Markdown notes.","itemImage":"Draw a flat Twemoji icon with transparent background.","recipeImage":"Photograph the finished dish in natural light."}});
    assert_eq!(
        request(
            &server,
            Method::PUT,
            "/api/ai/config",
            json!({"config":config,"apiKey":"fixture"}),
            Some(&owner)
        )
        .await
        .0,
        StatusCode::OK
    );
    for images in [
        json!(["https://example.test/private.png"]),
        json!(["/api/images/00000000-0000-0000-0000-000000000000"]),
        json!([
            upload["url"],
            upload["url"],
            upload["url"],
            upload["url"],
            upload["url"]
        ]),
    ] {
        assert_eq!(
            request(
                &server,
                Method::POST,
                "/api/ai/assistant",
                json!({"prompt":"Read this recipe","images":images}),
                Some(&owner)
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
    }
    let (status, proposal, _) = request(
        &server,
        Method::POST,
        "/api/ai/assistant",
        json!({"prompt":"","images":[upload["url"]],"imageNames":["Family recipe.png"]}),
        Some(&owner),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{proposal}");
    assert_eq!(
        proposal["recipes"][0]["sourceImages"],
        json!([{ "url":upload["url"],"name":"Family recipe.png" }])
    );
    let source_id = upload["url"]
        .as_str()
        .unwrap()
        .strip_prefix("/api/images/")
        .unwrap();
    // Active proposals protect their source even before any recipe is saved.
    server
        .db
        .lock()
        .unwrap()
        .execute(
            "UPDATE uploads SET created_at='2000-01-01T00:00:00Z' WHERE id=?1",
            [source_id],
        )
        .unwrap();
    assert_eq!(
        request(
            &server,
            Method::DELETE,
            upload["url"].as_str().unwrap(),
            Value::Null,
            Some(&owner)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(
            &server,
            Method::POST,
            "/api/images/cleanup",
            json!({}),
            Some(&owner)
        )
        .await
        .1["removed"],
        0
    );
    {
        let seen = calls.lock().unwrap();
        assert!(
            seen[0]["messages"][0]["content"]
                .as_str()
                .unwrap()
                .contains("Use metric quantities")
        );
        assert!(
            seen[0]["messages"][1]["content"][1]["image_url"]["url"]
                .as_str()
                .unwrap()
                .starts_with("data:image/webp;base64,")
        );
    }
    let before = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&owner),
    )
    .await
    .1;
    assert!(
        !before["state"]["recipeBook"]
            .as_array()
            .unwrap()
            .iter()
            .any(|recipe| recipe["name"] == "Screenshot recipe")
    );
    let (status,photo,_)=request(&server,Method::POST,"/api/ai/image",json!({"kind":"recipe","proposalId":proposal["id"],"recipeId":proposal["recipes"][0]["id"]}),Some(&owner)).await;
    assert_eq!(status, StatusCode::OK, "{photo}");
    assert!(
        calls.lock().unwrap()[1]["prompt"]
            .as_str()
            .unwrap()
            .contains("80 g Synthetic truffle flakes")
    );
    let (status,icon,_)=request(&server,Method::POST,"/api/ai/image",json!({"kind":"item","proposalId":proposal["id"],"productId":proposal["products"][0]["id"]}),Some(&owner)).await;
    assert_eq!(status, StatusCode::OK, "{icon}");
    {
        let seen = calls.lock().unwrap();
        assert_eq!(seen[2]["background"], "transparent");
        assert_eq!(seen[2]["size"], "816x816");
        assert_eq!(seen[2]["output_format"], "png");
        assert!(
            seen[2]["prompt"]
                .as_str()
                .unwrap()
                .contains("Draw a flat Twemoji icon")
        );
    }
    let (status,applied)=operation(&server,&owner,json!({"type":"applyProposal","proposalId":proposal["id"],"recipeIds":[proposal["recipes"][0]["id"]],"shoppingIndices":[],"days":[]})).await;
    assert_eq!(status, StatusCode::OK, "{applied}");
    let snapshot = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&owner),
    )
    .await
    .1;
    assert!(
        snapshot["state"]["recipeBook"]
            .as_array()
            .unwrap()
            .iter()
            .any(|recipe| recipe["image"] == photo["url"]
                && recipe["subtitle"]
                    .as_str()
                    .unwrap()
                    .contains("**Keep chilled**"))
    );
    let saved = snapshot["state"]["recipeBook"]
        .as_array()
        .unwrap()
        .iter()
        .find(|recipe| recipe["name"] == "Screenshot recipe")
        .unwrap();
    assert_eq!(
        saved["sourceImages"],
        proposal["recipes"][0]["sourceImages"]
    );
    assert_eq!(
        request(
            &server,
            Method::DELETE,
            upload["url"].as_str().unwrap(),
            Value::Null,
            Some(&owner)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(
            &server,
            Method::POST,
            "/api/images/cleanup",
            json!({}),
            Some(&owner)
        )
        .await
        .1["removed"],
        0
    );
    assert!(
        snapshot["state"]["customProducts"]
            .as_array()
            .unwrap()
            .iter()
            .any(|product| product["image"] == icon["url"])
    );
    let url = icon["url"].as_str().unwrap();
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
    assert_eq!(response.headers()[header::CONTENT_TYPE], "image/webp");
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let decoded = image::load_from_memory(&bytes).unwrap().to_rgba8();
    assert_eq!(decoded.dimensions(), (256, 256));
    assert_eq!(decoded.get_pixel(0, 0)[3], 0);
    assert_eq!(
        request(&server, Method::GET, url, Value::Null, None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let backup = request(
        &server,
        Method::GET,
        "/api/backup",
        Value::Null,
        Some(&owner),
    )
    .await
    .1;
    assert!(
        backup["images"]
            .as_array()
            .unwrap()
            .iter()
            .any(|image| image["source"] == true && image["id"] == source_id)
    );
    let (status, restored, _) = request(
        &server,
        Method::POST,
        "/api/restore",
        json!({"backup":backup,"expectedRevision":snapshot["revision"]}),
        Some(&owner),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{restored}");
    let restored_state = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&owner),
    )
    .await
    .1;
    let restored_recipe = restored_state["state"]["recipeBook"]
        .as_array()
        .unwrap()
        .iter()
        .find(|recipe| recipe["name"] == "Screenshot recipe")
        .unwrap();
    let restored_url = restored_recipe["sourceImages"][0]["url"].as_str().unwrap();
    assert_ne!(restored_url, upload["url"].as_str().unwrap());
    assert_eq!(
        restored_recipe["sourceImages"][0]["name"],
        "Family recipe.png"
    );
    let (source, archived): (bool, Vec<u8>) = server
        .db
        .lock()
        .unwrap()
        .query_row(
            "SELECT source,bytes FROM uploads WHERE household_id=?1 AND id=?2",
            rusqlite::params![
                household,
                restored_url.strip_prefix("/api/images/").unwrap()
            ],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert!(source);
    let archived = image::load_from_memory(&archived).unwrap().to_rgba8();
    assert_eq!(
        archived.dimensions(),
        (2048, 2048),
        "Source resolution survives household backup/restore"
    );
    assert_eq!(archived.get_pixel(0, 0)[3], 0);
    let bytes:Vec<u8>=server.db.lock().unwrap().query_row("SELECT bytes FROM uploads WHERE household_id=?1 AND mime='image/webp' ORDER BY length(bytes) LIMIT 1",[&household],|row|row.get(0)).unwrap();
    assert_eq!(
        image::load_from_memory(&bytes)
            .unwrap()
            .to_rgba8()
            .get_pixel(0, 0)[3],
        0
    );
    task.abort();
}

#[tokio::test]
async fn recipe_sources_reject_missing_foreign_and_invalid_references_atomically() {
    let (server, _dir) = server();
    let owner = owner(&server).await;
    let snapshot = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&owner),
    )
    .await
    .1;
    let original = snapshot["state"]["recipeBook"][0].clone();
    let foreign_id = uuid::Uuid::new_v4().to_string();
    {
        let conn = server.db.lock().unwrap();
        conn.execute("INSERT INTO households(id,name,state,revision) VALUES('other-source-household','Other',?1,0)",[snapshot["state"].to_string()]).unwrap();
        conn.execute("INSERT INTO uploads(id,household_id,mime,bytes,created_at) VALUES(?1,'other-source-household','image/png',X'01',?2)",rusqlite::params![foreign_id,chrono::Utc::now().to_rfc3339()]).unwrap();
    }
    for sources in [
        json!([{"url":"https://example.test/source.png","name":"Source"}]),
        json!([{"url":format!("/api/images/{}",uuid::Uuid::new_v4()),"name":"Missing"}]),
        json!([{"url":format!("/api/images/{foreign_id}"),"name":"Foreign"}]),
        json!([{"url":format!("/api/images/{foreign_id}"),"name":""}]),
        json!([{"url":format!("/api/images/{foreign_id}"),"name":"One"},{"url":format!("/api/images/{foreign_id}"),"name":"Duplicate"}]),
    ] {
        let mut changed = original.clone();
        changed["sourceImages"] = sources;
        let (status,body) = operation(&server,&owner,json!({"type":"patch","label":"Edit sources","changes":[{"collection":"recipeBook","key":original["id"],"field":null,"before":original,"after":changed}]})).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    }
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
        snapshot
    );
}

#[tokio::test]
async fn family_rename_is_owner_only_scoped_and_rejects_stale_names() {
    let (server, _dir) = server();
    let owner = owner(&server).await;
    let current = request(
        &server,
        Method::GET,
        "/api/auth/me",
        Value::Null,
        Some(&owner),
    )
    .await
    .1;
    let mut notices = server.notices.subscribe();
    let body = json!({"name":"New family","expectedName":current["householdName"]});
    assert_eq!(
        request(&server, Method::PUT, "/api/household", body.clone(), None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    server
        .db
        .lock()
        .unwrap()
        .execute("UPDATE users SET role='member'", [])
        .unwrap();
    assert_eq!(
        request(
            &server,
            Method::PUT,
            "/api/household",
            body.clone(),
            Some(&owner)
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    server
        .db
        .lock()
        .unwrap()
        .execute("UPDATE users SET role='owner'", [])
        .unwrap();
    assert_eq!(
        request(
            &server,
            Method::PUT,
            "/api/household",
            body.clone(),
            Some(&owner)
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        notices.try_recv().unwrap(),
        current["householdId"].as_str().unwrap()
    );
    assert_eq!(
        request(
            &server,
            Method::GET,
            "/api/auth/me",
            Value::Null,
            Some(&owner)
        )
        .await
        .1["householdName"],
        "New family"
    );
    assert_eq!(
        request(&server, Method::PUT, "/api/household", body, Some(&owner))
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        request(
            &server,
            Method::PUT,
            "/api/household",
            json!({"name":" ","expectedName":"New family"}),
            Some(&owner)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
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
            amounts: None,
            note: None,
            expected: None,
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
            amounts: None,
            note: None,
            expected: None,
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

#[tokio::test]
async fn saved_rates_project_stock_without_purchase_history_and_shelf_life_is_validated() {
    let (server, _dir) = server();
    let owner = owner(&server).await;
    operation(&server,&owner,json!({"type":"patch","label":"Set consumption","changes":[{"collection":"consumptionRates","key":"coffee","field":null,"before":null,"after":{"quantity":1.0,"unit":"pc","days":1.0}}]})).await;
    operation(
        &server,
        &owner,
        json!({"type":"observePantry","productId":"coffee","quantity":1.0,"unit":"pc","expiresAt":null}),
    )
    .await;
    let (status, insights, _) = request(
        &server,
        Method::GET,
        "/api/insights",
        Value::Null,
        Some(&owner),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{insights}");
    assert_eq!(insights["stock"][0]["productId"], "coffee");
    assert_eq!(insights["stock"][0]["status"], "low");
    assert_eq!(insights["stock"][0]["rateSource"], "manual");
    assert_eq!(insights["restock"][0]["product"]["id"], "coffee");
    assert!(
        insights["restock"][0]["reason"]
            .as_str()
            .unwrap()
            .contains("left")
    );
    // A failed projection must never poison the shared database lock.
    let (status, _, _) = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&owner),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let shelf = |after: Value| json!({"type":"patch","label":"Shelf life","changes":[{"collection":"shelfLifeDays","key":"coffee","field":null,"before":null,"after":after}]});
    for invalid in [json!(0.1), json!(5000.0)] {
        let (status, _, _) = request(
            &server,
            Method::POST,
            "/api/operations",
            json!({"id":uuid::Uuid::new_v4().to_string(),"operation":shelf(invalid)}),
            Some(&owner),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
    operation(&server, &owner, shelf(json!(7.0))).await;
    let snapshot = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&owner),
    )
    .await
    .1;
    assert_eq!(snapshot["state"]["shelfLifeDays"]["coffee"], 7.0);
    let insights = request(
        &server,
        Method::GET,
        "/api/insights",
        Value::Null,
        Some(&owner),
    )
    .await
    .1;
    assert_eq!(insights["stock"][0]["useWithinDays"], 7.0);
}

#[tokio::test]
async fn configured_consumption_is_guarded_validated_and_controls_restock_without_learning() {
    let (server, _dir) = server();
    let owner = owner(&server).await;
    let rate = json!({"quantity":2.0,"unit":"L","days":4.0});
    let patch = |before: Value, after: Value| json!({"type":"patch","label":"Set consumption","changes":[{"collection":"consumptionRates","key":"oat-milk","field":null,"before":before,"after":after}]});
    assert_eq!(
        operation(&server, &owner, patch(Value::Null, rate.clone()))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        operation(
            &server,
            &owner,
            patch(Value::Null, json!({"quantity":4,"unit":"L","days":7}))
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        operation(
            &server,
            &owner,
            patch(rate.clone(), json!({"quantity":2,"unit":"L","days":0}))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    operation(&server,&owner,json!({"type":"addItem","productId":"oat-milk","quantity":2,"unit":"L","note":"","accumulate":false})).await;
    operation(
        &server,
        &owner,
        json!({"type":"checkItem","id":"oat-milk","checked":true}),
    )
    .await;
    {
        let conn = server.db.lock().unwrap();
        conn.execute(
            "UPDATE events SET at=?1 WHERE kind='checkItem'",
            [(chrono::Utc::now() - chrono::Duration::days(5)).to_rfc3339()],
        )
        .unwrap();
    }
    let insights = request(
        &server,
        Method::GET,
        "/api/insights",
        Value::Null,
        Some(&owner),
    )
    .await
    .1;
    assert_eq!(insights["habits"][0]["estimatedConsumption"], Value::Null);
    assert_eq!(insights["habits"][0]["consumptionRate"], rate);
    assert_eq!(insights["habits"][0]["consumptionSource"], "manual");
    assert_eq!(insights["restock"][0]["intervalDays"], 4);
    assert!(
        insights["restock"][0]["reason"]
            .as_str()
            .unwrap()
            .contains("Your rate")
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
    assert_eq!(snapshot["state"]["consumptionRates"]["oat-milk"], rate);
    assert_eq!(
        operation(&server, &owner, patch(rate, Value::Null)).await.0,
        StatusCode::OK
    );
    let insights = request(
        &server,
        Method::GET,
        "/api/insights",
        Value::Null,
        Some(&owner),
    )
    .await
    .1;
    assert_eq!(insights["habits"][0]["consumptionSource"], "learning");
    assert_eq!(insights["restock"], json!([]));
}

#[tokio::test]
async fn pantry_edits_keep_multiple_units_and_notes_and_reject_stale_observations() {
    let (server, _dir) = server();
    let owner = owner(&server).await;
    let first=operation(&server,&owner,json!({"type":"observePantry","productId":"rice","quantity":500,"unit":"g","expiresAt":null})).await;
    assert_eq!(first.0, StatusCode::OK);
    let expected = first.1["state"]["pantry"]["rice"].clone();
    let edit = json!({"type":"observePantry","productId":"rice","quantity":0.75,"unit":"kg","amounts":[{"quantity":0.75,"unit":"kg"},{"quantity":2,"unit":"bag"}],"note":"Opened cupboard pack","expiresAt":"2026-12-31","expected":expected});
    let (status, snapshot) = operation(&server, &owner, edit.clone()).await;
    assert_eq!(status, StatusCode::OK);
    let pantry = &snapshot["state"]["pantry"]["rice"];
    assert_eq!(
        pantry["amounts"],
        json!([{"quantity":2.0,"unit":"bag"},{"quantity":750.0,"unit":"g"}])
    );
    assert_eq!(pantry["note"], "Opened cupboard pack");
    assert_eq!(pantry["expiresAt"], "2026-12-31");
    assert_eq!(pantry["confirmed"], true);
    assert_eq!(
        operation(&server, &owner, edit).await.0,
        StatusCode::CONFLICT
    );
    let current = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&owner),
    )
    .await
    .1;
    assert_eq!(current["state"], snapshot["state"]);
    assert_eq!(current["revision"], snapshot["revision"]);
    let invalid = json!({"type":"observePantry","productId":"rice","quantity":1,"unit":"g","amounts":[{"quantity":-1,"unit":"g"}],"expiresAt":null});
    assert_eq!(
        operation(&server, &owner, invalid).await.0,
        StatusCode::BAD_REQUEST
    );
    let mut expected = pantry.clone();
    expected["observedAt"] = json!("2026-01-01T00:00:00Z");
    let queued = json!({"type":"observePantry","productId":"rice","quantity":800,"unit":"g","amounts":[{"quantity":800,"unit":"g"},{"quantity":2,"unit":"bag"}],"expiresAt":"2026-12-31","note":"Opened cupboard pack","expected":expected});
    assert_eq!(
        operation(&server, &owner, queued).await.0,
        StatusCode::OK,
        "Equivalent queued amounts must not conflict because of device/server clock differences"
    );
}

#[tokio::test]
async fn partial_store_routes_are_guarded_validated_and_survive_backup_restore() {
    let (server, _dir) = server();
    let cookie = owner(&server).await;
    let mut snapshot = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&cookie),
    )
    .await
    .1;
    let store = snapshot["state"]["stores"][0].clone();
    let id = store["id"].clone();
    let order = json!(["Vegetables", "Fruits"]);
    let patch = |before: Value, after: Value| json!({"type":"patch","label":"Choose aisles","changes":[{"collection":"stores","key":id,"field":"order","before":before,"after":after}]});
    let (status, saved) = operation(
        &server,
        &cookie,
        patch(store["order"].clone(), order.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["state"]["stores"][0]["order"], order);
    for invalid in [
        json!(["Fruits", "Fruits"]),
        json!(["Not a household group"]),
    ] {
        assert_eq!(
            operation(&server, &cookie, patch(order.clone(), invalid))
                .await
                .0,
            StatusCode::BAD_REQUEST
        );
    }
    assert_eq!(
        operation(&server, &cookie, patch(store["order"].clone(), json!([])))
            .await
            .0,
        StatusCode::CONFLICT
    );
    let backup = request(
        &server,
        Method::GET,
        "/api/backup",
        Value::Null,
        Some(&cookie),
    )
    .await
    .1;
    assert_eq!(
        operation(&server, &cookie, patch(order.clone(), json!([])))
            .await
            .0,
        StatusCode::OK
    );
    snapshot = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&cookie),
    )
    .await
    .1;
    let (status, restored, _) = request(
        &server,
        Method::POST,
        "/api/restore",
        json!({"backup":backup,"expectedRevision":snapshot["revision"]}),
        Some(&cookie),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{restored}");
    let state = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&cookie),
    )
    .await
    .1;
    assert_eq!(state["state"]["stores"][0]["order"], order);
    assert_eq!(
        server
            .db
            .lock()
            .unwrap()
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| row
                .get::<_, i64>(
                0
            ))
            .unwrap(),
        14
    );
    // Old catalog customizations lacking images inherit new bundled art.
    let mut household: model::HouseholdState =
        serde_json::from_value(state["state"].clone()).unwrap();
    let mut pasta = domain::product(&household, "pasta").unwrap();
    let original = pasta.image.clone();
    assert!(original.is_some());
    pasta.name = "Family pasta".into();
    pasta.image = None;
    household.product_details.insert("pasta".into(), pasta);
    assert_eq!(
        domain::product(&household, "pasta").unwrap().image,
        original
    );
    household
        .product_images
        .insert("pasta".into(), "/api/images/family-photo".into());
    assert_eq!(
        domain::product(&household, "pasta")
            .unwrap()
            .image
            .as_deref(),
        Some("/api/images/family-photo")
    );
    for (name, image) in [
        ("Water", "water"),
        ("Basil", "basil"),
        ("Grated Emmental–mozzarella cheese", "grated-cheese"),
    ] {
        household.custom_products.push(model::Product {
            id: "family-alias".into(),
            name: name.into(),
            category: "Ingredients".into(),
            icon: "🛒".into(),
            image: None,
            aliases: vec![],
            interval: None,
        });
        let item = domain::product(&household, "family-alias").unwrap();
        assert_eq!(
            item.image,
            Some(format!("/images/catalog/generated/{image}.webp"))
        );
        assert!(!icon_jobs::missing_icon(&item));
        household.custom_products.pop();
    }
}

#[tokio::test]
async fn store_map_vision_is_private_validated_review_only_and_companion_compatible() {
    let (server, _dir) = server();
    let cookie = owner(&server).await;
    let snapshot = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&cookie),
    )
    .await
    .1;
    let household: String = server
        .db
        .lock()
        .unwrap()
        .query_row("SELECT id FROM households", [], |row| row.get(0))
        .unwrap();
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
        24,
        24,
        image::Rgba([10, 80, 10, 255]),
    ))
    .write_to(&mut png, image::ImageFormat::Png)
    .unwrap();
    let image_id = uuid::Uuid::new_v4().to_string();
    let foreign_id = uuid::Uuid::new_v4().to_string();
    {
        let conn = server.db.lock().unwrap();
        conn.execute(
            "INSERT INTO households(id,name,state) VALUES('map-other','Other',?1)",
            [snapshot["state"].to_string()],
        )
        .unwrap();
        for (id, owner) in [(&image_id, household.as_str()), (&foreign_id, "map-other")] {
            conn.execute("INSERT INTO uploads(id,household_id,mime,bytes,created_at,source) VALUES(?1,?2,'image/png',?3,?4,1)", rusqlite::params![id, owner, png.get_ref(), chrono::Utc::now().to_rfc3339()]).unwrap();
        }
    }
    let suggestion = json!({"message":"Produce first, then dairy. Other aisles are not shown clearly.","order":["Fruits","Vegetables","Milk & eggs"]});
    let returned = std::sync::Arc::new(std::sync::Mutex::new(suggestion.clone()));
    let calls = std::sync::Arc::new(std::sync::Mutex::new(Vec::<Value>::new()));
    let fixture_returned = returned.clone();
    let fixture_calls = calls.clone();
    let fixture = Router::new().route(
        "/v1/chat/completions",
        post(move |Json(body): Json<Value>| {
            fixture_calls.lock().unwrap().push(body);
            let content = fixture_returned.lock().unwrap().to_string();
            async move { Json(json!({"choices":[{"message":{"content":content}}]})) }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, fixture).await.unwrap() });
    let config = json!({"enabled":true,"baseUrl":format!("http://{address}/v1"),"model":"gpt-6-luna","reasoningEffort":"xhigh","imageModel":"","imageSize":"1024x1024","responseFormat":"schema","tokenParameter":"omit"});
    assert_eq!(
        request(
            &server,
            Method::PUT,
            "/api/ai/config",
            json!({"config":config,"apiKey":"map-fixture-key"}),
            Some(&cookie)
        )
        .await
        .0,
        StatusCode::OK
    );
    let input = json!({"name":"Local shop","location":"Corner","order":snapshot["state"]["stores"][0]["order"],"images":[format!("/api/images/{image_id}")],"prompt":"Entrance at bottom left."});
    assert_eq!(
        request(
            &server,
            Method::POST,
            "/api/ai/store-layout",
            input.clone(),
            None
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    for images in [
        json!([]),
        json!(["https://example.test/map.png"]),
        json!([format!("/api/images/{foreign_id}")]),
        json!([
            format!("/api/images/{image_id}"),
            format!("/api/images/{image_id}")
        ]),
        json!(vec![format!("/api/images/{image_id}"); 5]),
    ] {
        let mut invalid = input.clone();
        invalid["images"] = images;
        assert_eq!(
            request(
                &server,
                Method::POST,
                "/api/ai/store-layout",
                invalid,
                Some(&cookie)
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
    }
    assert!(
        calls.lock().unwrap().is_empty(),
        "Invalid or foreign maps never reach a provider"
    );
    let (status, proposal, _) = request(
        &server,
        Method::POST,
        "/api/ai/store-layout",
        input.clone(),
        Some(&cookie),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{proposal}");
    assert_eq!(proposal, suggestion);
    let body = calls.lock().unwrap()[0].clone();
    assert_eq!(body["model"], "gpt-6-luna");
    assert_eq!(body["reasoning_effort"], "xhigh");
    assert_eq!(
        body["response_format"]["json_schema"]["name"],
        "littlecupboard_store_layout"
    );
    assert!(
        body["messages"][1]["content"][1]["image_url"]["url"]
            .as_str()
            .unwrap()
            .starts_with("data:image/")
    );
    assert!(!body.to_string().contains("map-fixture-key"));
    for invalid in [
        json!({"message":"Invented","order":["Nonexistent aisle"]}),
        json!({"message":"Duplicate","order":["Fruits","Fruits"]}),
        json!({"message":"","order":[]}),
        json!({"message":"Wrong shape","order":"Fruits"}),
    ] {
        *returned.lock().unwrap() = invalid;
        assert_eq!(
            request(
                &server,
                Method::POST,
                "/api/ai/store-layout",
                input.clone(),
                Some(&cookie)
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
    }
    // The personal companion gets the same vision contract and reasoning choice.
    let pairing = ai::provision_companion(&server, &household, "gpt-6-luna", "xhigh").unwrap();
    let headers = worker_headers(pairing["token"].as_str().unwrap());
    let _ = companion::heartbeat(axum::extract::State(server.clone()), headers.clone())
        .await
        .unwrap();
    let waiting_server = server.clone();
    let waiting_cookie = cookie.clone();
    let waiting = tokio::spawn(async move {
        request(
            &waiting_server,
            Method::POST,
            "/api/ai/store-layout",
            input,
            Some(&waiting_cookie),
        )
        .await
    });
    let job = wait_for_companion_job(&server, &headers).await;
    assert_eq!(job["path"], "chat/completions");
    assert_eq!(job["body"]["reasoning_effort"], "xhigh");
    assert_eq!(
        job["body"]["messages"][1]["content"][1]["type"],
        "image_url"
    );
    let _ = companion::complete(
        axum::extract::State(server.clone()),
        headers,
        Json(companion::Completion {
            id: job["id"].as_str().unwrap().into(),
            lease: job["lease"].as_str().unwrap().into(),
            failed: false,
            result: Some(json!({"choices":[{"message":{"content":suggestion.to_string()}}]})),
        }),
    )
    .await
    .unwrap();
    assert_eq!(waiting.await.unwrap().0, StatusCode::OK);
    assert_eq!(
        request(
            &server,
            Method::GET,
            "/api/state",
            Value::Null,
            Some(&cookie)
        )
        .await
        .1,
        snapshot,
        "Suggestions never change the shop before review and save"
    );
    task.abort();
}

fn batch_sheet(grid: u32) -> Vec<u8> {
    let mut sheet = image::RgbaImage::new(256, 256);
    let edge = 256 / grid;
    for row in 0..grid {
        for col in 0..grid {
            let cell = row * grid + col;
            let color = image::Rgba([20 + (cell * 13) as u8, 60, 170, 255]);
            for y in row * edge + edge / 4..(row + 1) * edge - edge / 4 {
                for x in col * edge + edge / 4..(col + 1) * edge - edge / 4 {
                    sheet.put_pixel(x, y, color);
                }
            }
        }
    }
    let mut png = std::io::Cursor::new(vec![]);
    image::DynamicImage::ImageRgba8(sheet)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    png.into_inner()
}

#[test]
fn icon_sheets_keep_row_major_subjects_alpha_and_padding_and_reject_invalid_output() {
    for count in [2usize, 3, 7, 16] {
        let grid = (count as f64).sqrt().ceil() as u32;
        let images = crate::icon_batch::split(&batch_sheet(grid), count, grid).unwrap();
        assert_eq!(images.len(), count);
        for (index, image) in images.into_iter().enumerate() {
            let icon = image::load_from_memory(&image.bytes).unwrap().to_rgba8();
            assert_eq!(icon.dimensions(), (256, 256));
            assert_eq!(icon.get_pixel(128, 128)[0], 20 + (index * 13) as u8);
            assert_eq!(icon.get_pixel(0, 0)[3], 0);
            assert!(icon.pixels().filter(|p| p[3] > 200).count() > 20_000);
        }
    }
    let mut png = std::io::Cursor::new(vec![]);
    image::DynamicImage::new_rgb8(256, 256)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    assert!(
        crate::icon_batch::split(png.get_ref(), 4, 2).is_err(),
        "Opaque sheets must not become photo-like square tiles"
    );
    assert!(
        crate::icon_batch::split(&batch_sheet(1), 4, 2).is_err(),
        "Missing cell subjects fail the whole sheet"
    );
}

#[tokio::test]
async fn icon_batches_use_one_request_keep_private_drafts_and_group_durable_jobs() {
    use axum::{Json, routing::post};
    use base64::Engine;
    let calls = Arc::new(Mutex::new(vec![]));
    let received = calls.clone();
    let block = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let started = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let gate = release.clone();
    let begin = started.clone();
    let blocking = block.clone();
    let fixture = Router::new().route("/v1/images/generations",post(move |Json(body):Json<Value>| {
        let grid = body["prompt"].as_str().unwrap().split("Required icon-sheet layout: ").nth(1).map(|s| s.split(' ').next().unwrap().parse::<u32>().unwrap()).unwrap_or(1);
        received.lock().unwrap().push(body);
        let wait = blocking.swap(false,std::sync::atomic::Ordering::SeqCst);
        let (gate,begin) = (gate.clone(),begin.clone());
        async move {
            if wait { begin.notify_one(); gate.notified().await; }
            Json(json!({"data":[{"b64_json":base64::engine::general_purpose::STANDARD.encode(batch_sheet(grid))}]}))
        }
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, fixture).await.unwrap() });
    let (server, _dir) = server();
    let owner = owner(&server).await;
    assert_eq!(request(&server,Method::PUT,"/api/ai/config",json!({"apiKey":"fixture","config":{"enabled":true,"autoItemIcons":true,"baseUrl":format!("http://{address}/v1"),"model":"fixture","imageModel":"gpt-image-2","imageSize":"1024x1024","responseFormat":"json","tokenParameter":"omit"}}),Some(&owner)).await.0,StatusCode::OK);
    let items = json!([{"id":"draft-one","name":"Millet flakes","category":"Grain products"},{"id":"draft-two","name":"Orange blossom water","category":"Ingredients"}]);
    assert_eq!(
        request(
            &server,
            Method::POST,
            "/api/ai/icon-batch",
            json!({"items":items}),
            None
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    for invalid in [
        json!([]),
        json!([items[0], items[0]]),
        json!([{"id":"bad","name":"Thing","category":"Not a group"}]),
        Value::Array(
            (0..17)
                .map(|i| json!({"id":format!("draft-{i}"),"name":"Thing","category":"Fruits"}))
                .collect(),
        ),
    ] {
        assert_eq!(
            request(
                &server,
                Method::POST,
                "/api/ai/icon-batch",
                json!({"items":invalid}),
                Some(&owner)
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
    }
    let before = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&owner),
    )
    .await
    .1;
    let (status, draft, _) = request(
        &server,
        Method::POST,
        "/api/ai/icon-batch",
        json!({"items":items}),
        Some(&owner),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{draft}");
    assert_eq!(draft["icons"].as_array().unwrap().len(), 2);
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
        before,
        "Draft generation cannot silently add products or update the household"
    );
    for (index, icon) in draft["icons"].as_array().unwrap().iter().enumerate() {
        assert_eq!(icon["id"], items[index]["id"]);
        let url = icon["url"].as_str().unwrap();
        assert_eq!(
            request(&server, Method::GET, url, Value::Null, None)
                .await
                .0,
            StatusCode::UNAUTHORIZED
        );
        let conn = server.db.lock().unwrap();
        let bytes: Vec<u8> = conn
            .query_row(
                "SELECT bytes FROM uploads WHERE id=?1",
                [url.strip_prefix("/api/images/").unwrap()],
                |r| r.get(0),
            )
            .unwrap();
        let image = image::load_from_memory(&bytes).unwrap().to_rgba8();
        assert_eq!(image.get_pixel(128, 128)[0], 20 + (index * 13) as u8);
    }
    let changes: Vec<_> = (0..17).map(|i|json!({"collection":"customProducts","key":format!("new-batch-{i:02}"),"field":null,"before":null,"after":{"id":format!("new-batch-{i:02}"),"name":format!("New batch item {i}"),"category":"Ingredients","icon":"🛒"}})).collect();
    assert_eq!(
        operation(
            &server,
            &owner,
            json!({"type":"patch","label":"Save recipe items","changes":changes})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        request(
            &server,
            Method::GET,
            "/api/ai/item-icons",
            Value::Null,
            Some(&owner)
        )
        .await
        .1["queued"],
        17
    );
    block.store(true, std::sync::atomic::Ordering::SeqCst);
    let runner = server.clone();
    let batch = tokio::spawn(async move { crate::icon_jobs::run_one(&runner).await.unwrap() });
    tokio::time::timeout(std::time::Duration::from_secs(5), started.notified())
        .await
        .unwrap();
    assert_eq!(
        request(
            &server,
            Method::GET,
            "/api/ai/item-icons",
            Value::Null,
            Some(&owner)
        )
        .await
        .1["running"],
        16
    );
    assert_eq!(operation(&server,&owner,json!({"type":"patch","label":"Choose an icon during batch","changes":[{"collection":"productImages","key":"new-batch-00","field":null,"before":null,"after":"/images/pasta.jpg"}]})).await.0,StatusCode::OK);
    release.notify_one();
    assert!(batch.await.unwrap());
    let (_, jobs, _) = request(
        &server,
        Method::GET,
        "/api/ai/item-icons",
        Value::Null,
        Some(&owner),
    )
    .await;
    assert_eq!(
        jobs["completed"], 15,
        "A chosen icon in the running sheet is skipped without losing other crops"
    );
    assert_eq!(jobs["skipped"], 1);
    assert_eq!(jobs["queued"], 1);
    assert!(crate::icon_jobs::run_one(&server).await.unwrap());
    assert!(!crate::icon_jobs::run_one(&server).await.unwrap());
    let shared = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&owner),
    )
    .await
    .1;
    assert_eq!(
        shared["state"]["productImages"].as_object().unwrap().len(),
        17
    );
    assert_eq!(
        shared["state"]["productImages"]["new-batch-00"],
        "/images/pasta.jpg"
    );
    assert_eq!(
        server
            .db
            .lock()
            .unwrap()
            .query_row("SELECT count(*) FROM item_icon_attempts", [], |r| r
                .get::<_, u32>(0))
            .unwrap(),
        2,
        "The hourly budget counts provider requests, not crops"
    );
    let calls = calls.lock().unwrap();
    assert_eq!(calls.len(), 3);
    assert_eq!(calls[0]["size"], "1024x1024");
    assert_eq!(calls[1]["size"], "1024x1024");
    assert_eq!(calls[2]["size"], "816x816");
    assert!(
        calls[1]["prompt"]
            .as_str()
            .unwrap()
            .contains("4 rows and 4 columns")
    );
    assert!(
        calls.iter().all(|c| c["background"] == "transparent"
            && c["prompt"].as_str().unwrap().contains("Twemoji"))
    );
    task.abort();
}

#[tokio::test]
async fn companion_icon_sheets_keep_the_personal_transport_style_and_private_crops() {
    use base64::Engine;
    let (server, _dir) = server();
    let owner = owner(&server).await;
    let household: String = server
        .db
        .lock()
        .unwrap()
        .query_row("SELECT id FROM households", [], |r| r.get(0))
        .unwrap();
    let pairing = ai::provision_companion(&server, &household, "gpt-6-luna", "xhigh").unwrap();
    let headers = worker_headers(pairing["token"].as_str().unwrap());
    let _ = companion::heartbeat(axum::extract::State(server.clone()), headers.clone())
        .await
        .unwrap();
    let renderer = server.clone();
    let cookie = owner.clone();
    let waiting = tokio::spawn(async move {
        request(&renderer,Method::POST,"/api/ai/icon-batch",json!({"items":[{"id":"new-a","name":"Millet flakes","category":"Ingredients"},{"id":"new-b","name":"Juniper berries","category":"Spices"}]}),Some(&cookie)).await
    });
    let job = wait_for_companion_job(&server, &headers).await;
    assert_eq!(job["path"], "images/generations");
    assert_eq!(job["body"]["size"], "1024x1024");
    assert_eq!(job["body"]["background"], "transparent");
    assert_eq!(job["body"]["model"], "gpt-image-2-medium");
    assert!(
        job["body"]["reference_images"][0]
            .as_str()
            .unwrap()
            .starts_with("data:image/png;base64,")
    );
    assert!(
        job["body"]["prompt"]
            .as_str()
            .unwrap()
            .contains("2 rows and 2 columns")
    );
    let _ = companion::complete(axum::extract::State(server.clone()),headers,Json(companion::Completion {
        id:job["id"].as_str().unwrap().into(),lease:job["lease"].as_str().unwrap().into(),failed:false,
        result:Some(json!({"data":[{"b64_json":base64::engine::general_purpose::STANDARD.encode(batch_sheet(2))}]})),
    })).await.unwrap();
    let (status, result, _) = waiting.await.unwrap();
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(result["icons"].as_array().unwrap().len(), 2);
    for icon in result["icons"].as_array().unwrap() {
        assert_eq!(
            request(
                &server,
                Method::GET,
                icon["url"].as_str().unwrap(),
                Value::Null,
                None
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
    }
}

#[tokio::test]
async fn library_only_recipes_block_new_plans_preserve_existing_meals_and_survive_backup() {
    let (server, _dir) = server();
    let owner = owner(&server).await;
    let mut dessert = serde_json::to_value(&model::seed().recipes[0]).unwrap();
    dessert["id"] = json!("family-dessert");
    dessert["name"] = json!("Berry pudding");
    dessert["tag"] = json!("Desserts");
    dessert["tags"] = json!(["Desserts"]);
    dessert["mealPlanEligible"] = json!(false);
    assert_eq!(operation(&server,&owner,json!({"type":"patch","label":"Add dessert","changes":[{"collection":"recipeBook","key":"family-dessert","field":null,"before":null,"after":dessert}]})).await.0,StatusCode::OK);
    let before = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&owner),
    )
    .await
    .1;
    let day = "2026-10-08";
    let old = &before["state"]["plan"][day];
    let plan = json!({"type":"patch","label":"Plan dessert","changes":[{"collection":"plan","key":day,"field":null,"before":old,"after":"family-dessert"}]});
    let (status, error) = operation(&server, &owner, plan.clone()).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(
        error["message"]
            .as_str()
            .unwrap()
            .contains("excluded from meal planning")
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
        before,
        "Rejected schedule changes are atomic"
    );
    assert_eq!(operation(&server,&owner,json!({"type":"patch","label":"Enable dessert planning","changes":[{"collection":"recipeBook","key":"family-dessert","field":"mealPlanEligible","before":false,"after":true}]})).await.0,StatusCode::OK);
    assert_eq!(operation(&server, &owner, plan).await.0, StatusCode::OK);
    assert_eq!(operation(&server,&owner,json!({"type":"patch","label":"Exclude from future planning","changes":[{"collection":"recipeBook","key":"family-dessert","field":"mealPlanEligible","before":true,"after":false}]})).await.0,StatusCode::OK);
    let saved = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&owner),
    )
    .await
    .1;
    assert_eq!(
        saved["state"]["plan"][day], "family-dessert",
        "Existing deliberate meals remain intact"
    );
    let (_, backup, _) = request(
        &server,
        Method::GET,
        "/api/backup",
        Value::Null,
        Some(&owner),
    )
    .await;
    assert_eq!(
        backup["state"]["recipeBook"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["id"] == "family-dessert")
            .unwrap()["mealPlanEligible"],
        false
    );
    assert_eq!(
        request(
            &server,
            Method::POST,
            "/api/restore",
            json!({"backup":backup,"expectedRevision":saved["revision"]}),
            Some(&owner)
        )
        .await
        .0,
        StatusCode::OK
    );
    let restored = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&owner),
    )
    .await
    .1;
    assert_eq!(restored["state"]["plan"][day], "family-dessert");
    assert_eq!(
        restored["state"]["recipeBook"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["id"] == "family-dessert")
            .unwrap()["mealPlanEligible"],
        false
    );
}

#[tokio::test]
async fn assistant_keeps_dessert_drafts_in_the_library_and_rejects_excluded_schedules() {
    use axum::{Json, routing::post};
    let reply = Arc::new(Mutex::new(Value::Null));
    let received = Arc::new(Mutex::new(vec![]));
    let (output, calls) = (reply.clone(), received.clone());
    let fixture = Router::new().route(
        "/v1/chat/completions",
        post(move |Json(body): Json<Value>| {
            calls.lock().unwrap().push(body);
            let content = output.lock().unwrap().to_string();
            async move { Json(json!({"choices":[{"message":{"content":content}}]})) }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, fixture).await.unwrap() });
    let (server, _dir) = server();
    let owner = owner(&server).await;
    assert_eq!(request(&server,Method::PUT,"/api/ai/config",json!({"apiKey":"fixture","config":{"enabled":true,"baseUrl":format!("http://{address}/v1"),"model":"fixture","imageModel":"","imageSize":"1024x1024","responseFormat":"schema","tokenParameter":"omit"}}),Some(&owner)).await.0,StatusCode::OK);
    let dessert = json!({"name":"Berry pudding","subtitle":"Serve chilled.","minutes":10,"servings":4,"tags":["Desserts"],"mealPlanEligible":false,"ingredients":[{"name":"Strawberries","productId":"strawberries","category":null,"quantity":250,"unit":"g","note":""}],"steps":["Chill the berries."]});
    *reply.lock().unwrap() = json!({"message":"A dessert for your recipe collection.","shopping":[],"plan":[],"recipes":[dessert]});
    let (status, proposal, _) = request(
        &server,
        Method::POST,
        "/api/ai/assistant",
        json!({"prompt":"Suggest a berry dessert"}),
        Some(&owner),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{proposal}");
    assert_eq!(proposal["recipes"][0]["mealPlanEligible"], false);
    assert_eq!(operation(&server,&owner,json!({"type":"applyProposal","proposalId":proposal["id"],"recipeIds":[proposal["recipes"][0]["id"]],"shoppingIndices":[],"days":[]})).await.0,StatusCode::OK);
    let snapshot = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&owner),
    )
    .await
    .1;
    let state: model::HouseholdState = serde_json::from_value(snapshot["state"].clone()).unwrap();
    let day = domain::today(&state);
    for plan in [
        json!([{"day":day,"recipeId":null,"draftIndex":0,"servings":4}]),
        json!([{"day":day,"recipeId":proposal["recipes"][0]["id"],"draftIndex":null,"servings":4}]),
    ] {
        *reply.lock().unwrap() = json!({"message":"Invalid dessert schedule.","shopping":[],"plan":plan,"recipes":[dessert]});
        let (status, error, _) = request(
            &server,
            Method::POST,
            "/api/ai/assistant",
            json!({"prompt":"Plan lunches"}),
            Some(&owner),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
        assert!(
            error["message"]
                .as_str()
                .unwrap()
                .contains("excluded from meal planning")
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
            snapshot
        );
    }
    let seen = received.lock().unwrap();
    assert!(
        seen[0]["messages"][0]["content"]
            .as_str()
            .unwrap()
            .contains("Never schedule recipes whose mealPlanEligible is false")
    );
    assert_eq!(
        seen[0]["response_format"]["json_schema"]["schema"]["properties"]["recipes"]["items"]["properties"]
            ["mealPlanEligible"]["type"],
        "boolean"
    );
    assert!(
        seen[1]["messages"][1]["content"]
            .as_str()
            .unwrap()
            .contains("\"mealPlanEligible\":false")
    );
    task.abort();
}

async fn wait_for_companion_job(server: &Server, headers: &axum::http::HeaderMap) -> Value {
    tokio::time::timeout(std::time::Duration::from_secs(30), async {
        loop {
            let job = companion::claim(axum::extract::State(server.clone()), headers.clone())
                .await
                .unwrap()
                .0["job"]
                .clone();
            if !job.is_null() {
                return job;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("The request did not enqueue a companion job within 30 seconds")
}

#[tokio::test]
async fn a_panic_holding_the_database_lock_does_not_break_later_requests() {
    let (server, _dir) = server();
    let owner = owner(&server).await;
    let db = server.db.clone();
    let panicked = std::thread::spawn(move || {
        let conn = db.lock().unwrap();
        conn.execute_batch("BEGIN IMMEDIATE; UPDATE households SET revision=revision+1000;")
            .unwrap();
        panic!("simulated handler bug");
    })
    .join();
    assert!(panicked.is_err());
    assert!(server.db.0.is_poisoned());
    {
        let conn = server
            .db
            .lock()
            .expect("a poisoned connection is recovered");
        assert!(
            conn.is_autocommit(),
            "the unfinished transaction was rolled back"
        );
        let revision: i64 = conn
            .query_row("SELECT MAX(revision) FROM households", [], |row| row.get(0))
            .unwrap();
        assert!(revision < 1000);
    }
    assert!(!server.db.0.is_poisoned());
    let (status, _, _) = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&owner),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    operation(
        &server,
        &owner,
        json!({"type":"addItem","productId":"milk","quantity":1.0,"unit":"L","note":"","accumulate":false}),
    )
    .await;
}

#[tokio::test]
async fn panicking_handlers_answer_with_an_internal_error() {
    let response = super::panic_response(Box::new("boom"));
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let body: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        body["message"],
        "The operation could not be completed. Please try again."
    );
}

#[tokio::test]
async fn item_details_fill_missing_fields_and_keep_family_choices() {
    let (server, _dir) = server();
    let cookie = owner(&server).await;
    let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::<Value>::new()));
    let captured = seen.clone();
    let answer = std::sync::Arc::new(std::sync::Mutex::new(
        json!({"group":"Milk & eggs","quantity":2,"unit":"kg","note":"Model note","iconDescription":"A yellow tub with a green lid","shelfLifeDays":44.8}),
    ));
    let reply = answer.clone();
    let fixture = Router::new().route(
        "/v1/chat/completions",
        post(move |Json(body): Json<Value>| {
            let captured = captured.clone();
            let reply = reply.clone();
            async move {
                captured.lock().unwrap().push(body);
                let content = reply.lock().unwrap().to_string();
                Json(json!({"choices":[{"message":{"content":content}}]}))
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let provider = tokio::spawn(async move { axum::serve(listener, fixture).await.unwrap() });
    let config = json!({"enabled":true,"baseUrl":format!("http://{address}/v1"),"model":"fixture-chat","reasoningEffort":"xhigh","imageModel":"","imageSize":"1024x1024","responseFormat":"schema","tokenParameter":"omit"});
    let (status, body, _) = request(
        &server,
        Method::PUT,
        "/api/ai/config",
        json!({"config":config,"apiKey":null}),
        Some(&cookie),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    // The family chose "pack" and wrote a note; those survive the answer.
    let (status, details, _) = request(
        &server,
        Method::POST,
        "/api/ai/item-details",
        json!({"name":"Margarine","unit":"pack","note":"Plant-based"}),
        Some(&cookie),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{details}");
    assert_eq!(details["unit"], "pack");
    assert_eq!(details["note"], "Plant-based");
    assert_eq!(details["group"], "Milk & eggs");
    assert_eq!(details["quantity"], 2.0);
    assert_eq!(details["iconDescription"], "A yellow tub with a green lid");
    assert_eq!(details["shelfLifeDays"], 45.0, "rounded to half days");
    let sent = seen.lock().unwrap().last().cloned().unwrap();
    assert_eq!(
        sent["reasoning_effort"], "low",
        "a quick task overrides deep reasoning"
    );
    assert_eq!(
        sent["model"], "fixture-chat",
        "blank quick model uses the chat model"
    );
    // An explicit quick-task model and effort are used as configured.
    let mut quick = config.clone();
    quick["quickModel"] = json!("fixture-quick");
    quick["quickReasoningEffort"] = json!("medium");
    let (status, body, _) = request(
        &server,
        Method::PUT,
        "/api/ai/config",
        json!({"config":quick,"apiKey":null}),
        Some(&cookie),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    request(
        &server,
        Method::POST,
        "/api/ai/item-details",
        json!({"name":"Margarine"}),
        Some(&cookie),
    )
    .await;
    let sent = seen.lock().unwrap().last().cloned().unwrap();
    assert_eq!(sent["model"], "fixture-quick");
    assert_eq!(sent["reasoning_effort"], "medium");
    // Without any reasoning setting, automatic mode sends none.
    let mut plain = config.clone();
    plain["reasoningEffort"] = json!("");
    request(
        &server,
        Method::PUT,
        "/api/ai/config",
        json!({"config":plain,"apiKey":null}),
        Some(&cookie),
    )
    .await;
    request(
        &server,
        Method::POST,
        "/api/ai/item-details",
        json!({"name":"Margarine"}),
        Some(&cookie),
    )
    .await;
    let sent = seen.lock().unwrap().last().cloned().unwrap();
    assert!(sent.get("reasoning_effort").is_none());
    let mut invalid = config.clone();
    invalid["quickReasoningEffort"] = json!("turbo");
    let (status, _, _) = request(
        &server,
        Method::PUT,
        "/api/ai/config",
        json!({"config":invalid,"apiKey":null}),
        Some(&cookie),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    request(
        &server,
        Method::PUT,
        "/api/ai/config",
        json!({"config":config,"apiKey":null}),
        Some(&cookie),
    )
    .await;
    // The first request carried the family's chosen fields.
    let sent = seen.lock().unwrap()[0].clone();
    assert_eq!(sent["response_format"]["type"], "json_schema");
    let user = sent["messages"][1]["content"].as_str().unwrap();
    assert!(user.contains("\"unit\":\"pack\"") && user.contains("Plant-based"));
    // Invented groups are rejected rather than saved.
    *answer.lock().unwrap() =
        json!({"group":"Made up","quantity":1,"unit":"pc","note":"","iconDescription":"x"});
    let (status, _, _) = request(
        &server,
        Method::POST,
        "/api/ai/item-details",
        json!({"name":"Margarine"}),
        Some(&cookie),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _, _) = request(
        &server,
        Method::POST,
        "/api/ai/item-details",
        json!({"name":" "}),
        Some(&cookie),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _, _) = request(
        &server,
        Method::POST,
        "/api/ai/item-details",
        json!({"name":"Margarine"}),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    provider.abort();
}

#[test]
fn automatic_meal_consumption_waits_for_lunch_and_never_backfills_old_plans() {
    let mut state = model::fresh_state(true, "UTC".into());
    let recipe = state.recipe_book[0].clone();
    let at = |text: &str| chrono::NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M").unwrap();
    for day in [
        "2026-10-01",
        "2026-10-05",
        "2026-10-06",
        "2026-10-07",
        "2026-10-08",
    ] {
        state.plan.insert(day.into(), recipe.id.clone());
    }
    // Before lunch today only the two catch-up days are used.
    assert_eq!(
        domain::auto_consume(&mut state, at("2026-10-07 09:00")),
        vec!["2026-10-05".to_string(), "2026-10-06".to_string()]
    );
    assert!(state.meal_feedback["2026-10-06"].automatic);
    // After 15:00 today's lunch counts too; old and future plans never do.
    assert_eq!(
        domain::auto_consume(&mut state, at("2026-10-07 15:30")),
        vec!["2026-10-07".to_string()]
    );
    assert!(!state.meal_feedback.contains_key("2026-10-01"));
    assert!(!state.meal_feedback.contains_key("2026-10-08"));
    assert!(domain::auto_consume(&mut state, at("2026-10-07 18:00")).is_empty());
}

#[tokio::test]
async fn planned_meals_use_cupboard_ingredients_and_can_still_be_skipped() {
    let (server, _dir) = server();
    let cookie = owner(&server).await;
    let snapshot = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&cookie),
    )
    .await
    .1;
    let zone: chrono_tz::Tz = snapshot["state"]["preferences"]["timeZone"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let servings = snapshot["state"]["preferences"]["servings"]
        .as_f64()
        .unwrap();
    let today = chrono::Utc::now().with_timezone(&zone).date_naive();
    let yesterday = (today - chrono::Duration::days(1)).to_string();
    let old = (today - chrono::Duration::days(6)).to_string();
    operation(&server, &cookie, json!({"type":"observePantry","productId":"pasta","quantity":1000.0,"unit":"g","expiresAt":null})).await;
    for day in [&yesterday, &old] {
        let (status, body) = operation(&server, &cookie, json!({"type":"patch","label":"Plan lunch","changes":[{"collection":"plan","key":day,"field":null,"before":null,"after":"green-pasta"}]})).await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }
    crate::meal_consumption::run(&server).unwrap();
    let state = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&cookie),
    )
    .await
    .1["state"]
        .clone();
    let expected = 1000.0 - 400.0 * servings / 4.0;
    assert_eq!(
        state["pantry"]["pasta"]["amounts"][0]["quantity"].as_f64(),
        Some(expected)
    );
    assert_eq!(state["mealFeedback"][&yesterday]["automatic"], true);
    assert_eq!(state["mealFeedback"][&yesterday]["status"], "cooked");
    assert!(
        state["mealFeedback"][&old].is_null(),
        "older plans are not backfilled"
    );
    let history = request(
        &server,
        Method::GET,
        "/api/history",
        Value::Null,
        Some(&cookie),
    )
    .await
    .1;
    assert_eq!(history[0]["kind"], "autoConsume");
    // Running again changes nothing.
    crate::meal_consumption::run(&server).unwrap();
    let history = request(
        &server,
        Method::GET,
        "/api/history",
        Value::Null,
        Some(&cookie),
    )
    .await
    .1;
    assert_eq!(
        history
            .as_array()
            .unwrap()
            .iter()
            .filter(|event| event["kind"] == "autoConsume")
            .count(),
        1
    );
    // Saying the meal was skipped returns the ingredients.
    let (status, body) = operation(&server, &cookie, json!({"type":"mealFeedback","day":yesterday,"recipeId":"green-pasta","status":"skipped","consume":false,"rating":null})).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let state = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&cookie),
    )
    .await
    .1["state"]
        .clone();
    assert_eq!(
        state["pantry"]["pasta"]["amounts"][0]["quantity"].as_f64(),
        Some(1000.0)
    );
    assert_eq!(state["mealFeedback"][&yesterday]["status"], "skipped");
    assert_eq!(state["mealFeedback"][&yesterday]["automatic"], false);
}

#[tokio::test]
async fn built_in_shelf_lives_can_be_turned_off_and_custom_items_estimated() {
    let (server, _dir) = server();
    let cookie = owner(&server).await;
    let state = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&cookie),
    )
    .await
    .1["state"]
        .clone();
    let mut household: model::HouseholdState = serde_json::from_value(state).unwrap();
    assert_eq!(domain::shelf_life(&household, "milk"), Some(7.0));
    assert_eq!(domain::shelf_life(&household, "flour"), None);
    household.shelf_life_days.insert("milk".into(), 0.0);
    assert_eq!(
        domain::shelf_life(&household, "milk"),
        None,
        "0 turns a default off"
    );
    domain::validate(&household).unwrap();
    household.shelf_life_days.insert("milk".into(), 0.2);
    assert!(domain::validate(&household).is_err());
    // The bulk estimate covers only the household's own items without a value.
    let custom = |id: &str, name: &str| json!({"collection":"customProducts","key":id,"field":null,"before":null,"after":{"id":id,"name":name,"category":"Snacks","icon":"🛒","aliases":[]}});
    let (status, body) = operation(&server, &cookie, json!({"type":"patch","label":"Add items","changes":[custom("homemade-dip","Homemade dip"), custom("salt-flakes","Salt flakes"), custom("known","Known item"), {"collection":"shelfLifeDays","key":"known","field":null,"before":null,"after":3.0}]})).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::<Value>::new()));
    let captured = seen.clone();
    let fixture = Router::new().route(
        "/v1/chat/completions",
        post(move |Json(body): Json<Value>| {
            let captured = captured.clone();
            async move {
                captured.lock().unwrap().push(body);
                let content = json!({"items":[{"productId":"homemade-dip","days":4.2},{"productId":"salt-flakes","days":null},{"productId":"milk","days":9},{"productId":"homemade-dip","days":1}]}).to_string();
                Json(json!({"choices":[{"message":{"content":content}}]}))
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let provider = tokio::spawn(async move { axum::serve(listener, fixture).await.unwrap() });
    let config = json!({"enabled":true,"baseUrl":format!("http://{address}/v1"),"model":"fixture-chat","imageModel":"","imageSize":"1024x1024","responseFormat":"schema","tokenParameter":"omit"});
    request(
        &server,
        Method::PUT,
        "/api/ai/config",
        json!({"config":config,"apiKey":null}),
        Some(&cookie),
    )
    .await;
    let (status, estimates, _) = request(
        &server,
        Method::POST,
        "/api/ai/shelf-lives",
        Value::Null,
        Some(&cookie),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{estimates}");
    assert_eq!(
        estimates,
        json!([{"productId":"homemade-dip","days":4.0},{"productId":"salt-flakes","days":null}]),
        "unknown ids and duplicates are dropped, values rounded"
    );
    let sent = seen.lock().unwrap()[0].to_string();
    assert!(sent.contains("homemade-dip") && sent.contains("salt-flakes"));
    assert!(
        !sent.contains("Known item"),
        "items with a value are not re-estimated"
    );
    provider.abort();
}

#[tokio::test]
async fn admin_shelf_lives_are_one_validated_undoable_change() {
    let (server, _dir) = server();
    let cookie = owner(&server).await;
    let household: String = server
        .db
        .lock()
        .unwrap()
        .query_row("SELECT id FROM households", [], |row| row.get(0))
        .unwrap();
    let values = std::collections::BTreeMap::from([
        ("milk".to_string(), Some(5.0)),
        ("flour".to_string(), Some(0.0)),
    ]);
    let (_, count) =
        api::admin_set_shelf_lives(&mut server.db.lock().unwrap(), &household, &values).unwrap();
    assert_eq!(count, 2);
    let (_, again) =
        api::admin_set_shelf_lives(&mut server.db.lock().unwrap(), &household, &values).unwrap();
    assert_eq!(again, 0, "unchanged values are skipped");
    let invalid = std::collections::BTreeMap::from([("missing-item".to_string(), Some(3.0))]);
    assert!(
        api::admin_set_shelf_lives(&mut server.db.lock().unwrap(), &household, &invalid).is_err()
    );
    let history = request(
        &server,
        Method::GET,
        "/api/history",
        Value::Null,
        Some(&cookie),
    )
    .await
    .1;
    let event = history[0]["id"].as_str().unwrap().to_string();
    let (status, body) = operation(&server, &cookie, json!({"type":"undo","eventId":event})).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let state = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&cookie),
    )
    .await
    .1;
    assert!(state["state"]["shelfLifeDays"]["milk"].is_null());
}

async fn upload_png(server: &Server, cookie: &str) -> String {
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(24, 24)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    let mut body = b"--item-photo\r\nContent-Disposition: form-data; name=\"image\"; filename=\"photo.png\"\r\nContent-Type: image/png\r\n\r\n".to_vec();
    body.extend(png.get_ref());
    body.extend(b"\r\n--item-photo--\r\n");
    let response = app(server.clone())
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/images?source=true")
                .header(header::COOKIE, cookie)
                .header(header::ORIGIN, &server.config.origin)
                .header("x-littlecupboard-request", "1")
                .header(
                    header::CONTENT_TYPE,
                    "multipart/form-data; boundary=item-photo",
                )
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let upload: Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    upload["url"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn item_photos_identify_existing_items_and_stay_private() {
    let (server, _dir) = server();
    let cookie = owner(&server).await;
    let answer = std::sync::Arc::new(std::sync::Mutex::new(Value::Null));
    let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::<Value>::new()));
    let (reply, captured) = (answer.clone(), seen.clone());
    let fixture = Router::new().route(
        "/v1/chat/completions",
        post(move |Json(body): Json<Value>| {
            let (reply, captured) = (reply.clone(), captured.clone());
            async move {
                captured.lock().unwrap().push(body);
                let content = reply.lock().unwrap().to_string();
                Json(json!({"choices":[{"message":{"content":content}}]}))
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let provider = tokio::spawn(async move { axum::serve(listener, fixture).await.unwrap() });
    let config = json!({"enabled":true,"baseUrl":format!("http://{address}/v1"),"model":"fixture-chat","imageModel":"","imageSize":"1024x1024","responseFormat":"schema","tokenParameter":"omit"});
    request(
        &server,
        Method::PUT,
        "/api/ai/config",
        json!({"config":config,"apiKey":null}),
        Some(&cookie),
    )
    .await;
    let photo = upload_png(&server, &cookie).await;
    let base = json!({"group":"Fruits","quantity":1,"unit":"pc","note":"","iconDescription":"x","shelfLifeDays":null});
    let ask = |answer_patch: Value| {
        let mut value = base.clone();
        value
            .as_object_mut()
            .unwrap()
            .extend(answer_patch.as_object().unwrap().clone());
        *answer.lock().unwrap() = value;
    };
    // The model's catalog pick wins and takes the catalog name and group.
    ask(json!({"name":"Rolled oats","productId":"oats"}));
    let (status, details, _) = request(
        &server,
        Method::POST,
        "/api/ai/item-details",
        json!({"images":[photo]}),
        Some(&cookie),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{details}");
    assert_eq!(details["productId"], "oats");
    assert_eq!(details["name"], "Oats");
    assert_eq!(details["group"], "Grain products");
    let sent = seen.lock().unwrap().last().cloned().unwrap();
    let parts = sent["messages"][1]["content"].as_array().unwrap();
    assert!(parts.iter().any(|part| part["type"] == "image_url"));
    assert!(
        parts[0]["text"].as_str().unwrap().contains("oats: Oats"),
        "the catalog is offered for matching"
    );
    // Without a pick, an exact name match still prevents a duplicate.
    ask(json!({"name":"milk","productId":null}));
    let details = request(
        &server,
        Method::POST,
        "/api/ai/item-details",
        json!({"images":[photo]}),
        Some(&cookie),
    )
    .await
    .1;
    assert_eq!(details["productId"], "milk");
    // Invented ids are ignored; a new product keeps the recognized name.
    ask(json!({"name":"Dragon fruit","productId":"not-a-product"}));
    let details = request(
        &server,
        Method::POST,
        "/api/ai/item-details",
        json!({"images":[photo]}),
        Some(&cookie),
    )
    .await
    .1;
    assert!(details["productId"].is_null());
    assert_eq!(details["name"], "Dragon fruit");
    // Photos must belong to this household.
    let (status, _, _) = request(
        &server,
        Method::POST,
        "/api/ai/item-details",
        json!({"images":["/api/images/00000000-0000-4000-8000-000000000000"]}),
        Some(&cookie),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let keep = |url: &str| json!({"type":"patch","label":"Keep photo","changes":[{"collection":"itemPhotos","key":"oats","field":null,"before":null,"after":[url]}]});
    let (status, body) = operation(
        &server,
        &cookie,
        keep("/api/images/00000000-0000-4000-8000-000000000000"),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    let (status, body) = operation(&server, &cookie, keep(&photo)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    // Referenced photos survive photo-storage cleanup.
    server
        .db
        .lock()
        .unwrap()
        .execute("UPDATE uploads SET created_at='2020-01-01T00:00:00Z'", [])
        .unwrap();
    let (status, cleaned, _) = request(
        &server,
        Method::POST,
        "/api/images/cleanup",
        Value::Null,
        Some(&cookie),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{cleaned}");
    assert_eq!(
        request(&server, Method::GET, &photo, Value::Null, Some(&cookie))
            .await
            .0,
        StatusCode::OK
    );
    provider.abort();
}

#[tokio::test]
async fn photo_jobs_add_or_buy_items_in_the_background_and_icons_apply_themselves() {
    use base64::Engine;
    let (server, _dir) = server();
    let cookie = owner(&server).await;
    let answer = std::sync::Arc::new(std::sync::Mutex::new(Value::Null));
    let reply = answer.clone();
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgba8(32, 32)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    let encoded = base64::engine::general_purpose::STANDARD.encode(png.into_inner());
    let fixture = Router::new()
        .route(
            "/v1/chat/completions",
            post(move || {
                let reply = reply.clone();
                async move {
                    let content = reply.lock().unwrap().to_string();
                    Json(json!({"choices":[{"message":{"content":content}}]}))
                }
            }),
        )
        .route(
            "/v1/images/generations",
            post(move || {
                let encoded = encoded.clone();
                async move { Json(json!({"data":[{"b64_json":encoded}]})) }
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let provider = tokio::spawn(async move { axum::serve(listener, fixture).await.unwrap() });
    let config = json!({"enabled":true,"baseUrl":format!("http://{address}/v1"),"model":"fixture-chat","imageModel":"fixture-image","imageSize":"1024x1024","responseFormat":"schema","tokenParameter":"omit"});
    request(
        &server,
        Method::PUT,
        "/api/ai/config",
        json!({"config":config,"apiKey":null}),
        Some(&cookie),
    )
    .await;
    // "I'm buying it now" for something new.
    *answer.lock().unwrap() = json!({"name":"Dragon fruit","productId":null,"group":"Fruits","quantity":2,"unit":"pc","note":"Ripe","iconDescription":"A pink fruit","shelfLifeDays":5});
    let photo = upload_png(&server, &cookie).await;
    let (status, created, _) = request(&server, Method::POST, "/api/ai/jobs", json!({"kind":"photo","scope":"photo","prompt":json!({"photo":photo,"mode":"bought"}).to_string(),"requestId":null,"proposalId":null,"recipeId":null,"productId":null,"items":null}), Some(&cookie)).await;
    assert_eq!(status, StatusCode::OK, "{created}");
    assert!(crate::image_jobs::run_one(&server).await.unwrap());
    let state = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&cookie),
    )
    .await
    .1["state"]
        .clone();
    let product = state["customProducts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["name"] == "Dragon fruit")
        .unwrap()
        .clone();
    let id = product["id"].as_str().unwrap();
    let item = state["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["id"] == id)
        .unwrap();
    assert_eq!(
        item["checked"], true,
        "bought items land in Recently checked"
    );
    assert_eq!(item["quantity"], 2.0);
    assert_eq!(state["itemPhotos"][id][0], photo.as_str());
    assert_eq!(state["shelfLifeDays"][id], 5.0);
    let history = request(
        &server,
        Method::GET,
        "/api/history",
        Value::Null,
        Some(&cookie),
    )
    .await
    .1;
    assert_eq!(history[0]["kind"], "checkItem");
    assert_eq!(history[0]["actor"], "Owner");
    let jobs = request(
        &server,
        Method::GET,
        "/api/ai/jobs?scope=photo",
        Value::Null,
        Some(&cookie),
    )
    .await
    .1;
    assert_eq!(jobs["jobs"][0]["name"], "Dragon fruit");
    // The queued icon attaches itself because the item had no picture.
    assert!(crate::image_jobs::run_one(&server).await.unwrap());
    let state = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&cookie),
    )
    .await
    .1["state"]
        .clone();
    assert!(
        state["productImages"][id]
            .as_str()
            .unwrap()
            .starts_with("/api/images/")
    );
    // "Add to list" for a known item reuses it, unchecked, with no icon job.
    *answer.lock().unwrap() = json!({"name":"Oats","productId":"oats","group":"Fruits","quantity":1,"unit":"pack","note":"","iconDescription":"x","shelfLifeDays":null});
    let photo = upload_png(&server, &cookie).await;
    request(&server, Method::POST, "/api/ai/jobs", json!({"kind":"photo","scope":"photo","prompt":json!({"photo":photo,"mode":"list"}).to_string(),"requestId":null,"proposalId":null,"recipeId":null,"productId":null,"items":null}), Some(&cookie)).await;
    assert!(crate::image_jobs::run_one(&server).await.unwrap());
    let state = request(
        &server,
        Method::GET,
        "/api/state",
        Value::Null,
        Some(&cookie),
    )
    .await
    .1["state"]
        .clone();
    let oats = state["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["id"] == "oats")
        .unwrap();
    assert_eq!(oats["checked"], false);
    assert_eq!(
        state["customProducts"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|p| p["name"] == "Oats")
            .count(),
        0
    );
    assert!(
        !crate::image_jobs::run_one(&server).await.unwrap(),
        "no icon job for an existing item"
    );
    // Photos from elsewhere are refused before any work is queued.
    let (status, _, _) = request(&server, Method::POST, "/api/ai/jobs", json!({"kind":"photo","scope":"photo","prompt":json!({"photo":"/api/images/00000000-0000-4000-8000-000000000000","mode":"bought"}).to_string(),"requestId":null,"proposalId":null,"recipeId":null,"productId":null,"items":null}), Some(&cookie)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    provider.abort();
}
