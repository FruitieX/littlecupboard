use axum::{Json, Router, routing::get};
use serde::Serialize;
use ts_rs::TS;

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/api/")]
struct HealthResponse {
    status: String,
    service: String,
}

#[tokio::main]
async fn main() {
    let app = Router::new().route("/api/health", get(health));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:3001")
        .await
        .expect("bind API port 3001");
    println!("ForkBasket API listening on http://127.0.0.1:3001");
    axum::serve(listener, app).await.expect("serve API");
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".into(),
        service: "forkbasket-api".into(),
    })
}
