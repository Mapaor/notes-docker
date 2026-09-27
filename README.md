# notes

Un servidor web i pàgina estàtica molt senzilla per autoallotjar-hi notes que vols poder-hi accedir des de qualsevol dispositiu o navegador, sense haver d'iniciar la sessió.

## Arquitectura
- Bakcend: Rust
- Base de dades: SQLite
- FrontEnd: HTML, CSS i JavaScript
- Crates: Axum, Tokio, SQLX, HTTP-Tower
- Volum Docker per la persistència de la base de dades

## Com arrencar el servidor

Clonar el repositori i des de l'arrel simplement fer:

```sh
docker compose up -d --build
```

La web la trobaràs a <http://localhost:8084>.

Al `.env` pots canviar el port si vols.

## API endpoints

### Obtenir notes

```sh
curl http://localhost:8084/api/notes
```


### Eliminar nota

```sh
curl -X POST http://localhost:8084/api/notes \
  -H 'content-type: application/json' \
  -d '{"content":"Provant 1, 2, 3... provaaaant."}'
```

### Eliminar nota

```sh
curl -i -X DELETE http://localhost:8084/api/notes/1
```


## Base de dades

SQLite aquí és simplement un fitxer (`/data/notes.db`). El qual muntem com a volum Docker per persistència.

La connexio amb la base de dades es gestiona amb `SqlitePoolOptions`, aquesta _pool_ es guarda a l'estat global (`AppState`).

El primer cop que arrenca el contenidor, es crea el fitxer, i s'executa una SQL query per generar la base dades.

```sql
CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
)
```

Cada endpoint del nostre servidor realment genera  una SQL query. 

`GET /api/notes` fa:
```sql
SELECT id, content, created_at
FROM notes
ORDER BY created_at DESC, id DESC
```

Els resultats obtinguts (les notes), es traslladen a la memòria interna via el trait `FromRow` de `SQLx`.

Per `POST /api/notes` és molt similar, es fa via SQLx la query següent:

```sql
INSERT INTO notes (content, created_at) VALUES (?, ?)
```

Substituïnt `?` per l'input content de veritat. 

Un altre avantatge de SQLx és que gestionoant ell les queries evita passar l'input directament a la query evitant així un possible atac de SQL Injection.

``PUT /api/notes/:id` seria:

```SQL
UPDATE notes
SET content = ?
WHERE id = ?
```

I `DELTE  /api/notes/:id` faria:

```SQL
DELETE FROM notes WHERE id = ?
```

## Llicència

MIT