use std::{
    env,
    net::SocketAddr,
    path::PathBuf,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    SqlitePool,
};
use tower_http::{services::ServeDir, trace::TraceLayer};
use tracing::info;

#[derive(Clone)]
struct AppState {
    db: SqlitePool,
    max_note_size: usize,
}

#[derive(Debug, Serialize, FromRow)]
struct Note {
    id: i64,
    content: String,
    created_at: i64,
}

#[derive(Deserialize)]
struct CreateNote {
    content: String,
}

#[derive(Serialize)]
struct ErrorBody {
    error: &'static str,
}

enum AppError {
    BadRequest(&'static str),
    NotFound,
    Internal,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, error) = match self {
            Self::BadRequest(message) => (StatusCode::BAD_REQUEST, message),
            Self::NotFound => (StatusCode::NOT_FOUND, "note not found"),
            Self::Internal => (StatusCode::INTERNAL_SERVER_ERROR, "internal server error"),
        };
        (status, Json(ErrorBody { error })).into_response()
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt::init();

    let port = env::var("PORT").unwrap_or_else(|_| "8084".into());
    let database_path = env::var("DATABASE_PATH").unwrap_or_else(|_| "/data/notes.db".into());
    let max_note_size = env::var("MAX_NOTE_SIZE")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(100_000);

    if let Some(parent) = PathBuf::from(&database_path).parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let database_options = SqliteConnectOptions::new()
        .filename(&database_path)
        .create_if_missing(true);
    let db = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(database_options)
        .await?;
    sqlx::query("CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, created_at INTEGER NOT NULL)")
        .execute(&db).await?;

    let state = Arc::new(AppState { db, max_note_size });
    let app = Router::new()
        .route("/api/notes", get(list_notes).post(create_note))
        .route("/api/notes/{id}", delete(delete_note).put(update_note))
        .fallback_service(ServeDir::new("static").append_index_html_on_directories(true))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let address = SocketAddr::from(([0, 0, 0, 0], port.parse()?));
    let listener = tokio::net::TcpListener::bind(address).await?;
    info!(%address, "notes listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn list_notes(State(state): State<Arc<AppState>>) -> Result<Json<Vec<Note>>, AppError> {
    let notes = sqlx::query_as::<_, Note>(
        "SELECT id, content, created_at FROM notes ORDER BY created_at DESC, id DESC",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::Internal)?;
    Ok(Json(notes))
}

async fn create_note(
    State(state): State<Arc<AppState>>,
    Json(input): Json<CreateNote>,
) -> Result<(StatusCode, Json<Note>), AppError> {
    if input.content.trim().is_empty() {
        return Err(AppError::BadRequest("note content cannot be empty"));
    }
    if input.content.len() > state.max_note_size {
        return Err(AppError::BadRequest("note content is too large"));
    }
    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| AppError::Internal)?
        .as_secs() as i64;
    let result = sqlx::query("INSERT INTO notes (content, created_at) VALUES (?, ?)")
        .bind(&input.content)
        .bind(created_at)
        .execute(&state.db)
        .await
        .map_err(|_| AppError::Internal)?;
    let note = Note {
        id: result.last_insert_rowid(),
        content: input.content,
        created_at,
    };
    Ok((StatusCode::CREATED, Json(note)))
}

async fn update_note(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Json(input): Json<CreateNote>,
) -> Result<Json<Note>, AppError> {
    if input.content.trim().is_empty() {
        return Err(AppError::BadRequest("note content cannot be empty"));
    }
    if input.content.len() > state.max_note_size {
        return Err(AppError::BadRequest("note content is too large"));
    }
    let result = sqlx::query("UPDATE notes SET content = ? WHERE id = ?")
        .bind(&input.content)
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|_| AppError::Internal)?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    let note = sqlx::query_as::<_, Note>("SELECT id, content, created_at FROM notes WHERE id = ?")
        .bind(id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| AppError::Internal)?;
    Ok(Json(note))
}

async fn delete_note(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    let result = sqlx::query("DELETE FROM notes WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|_| AppError::Internal)?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = terminate => {} }
}
