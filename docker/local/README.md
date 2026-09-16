# Local Docker inspection

Start a local fork daemon with seeded demo data:

```sh
./docker/local/up.sh
```

Open `http://localhost:8081` and sign in with the token in
`docker/local/.env`. The local stack is writable so you can inspect and edit
the seeded demo workspace.

To reset the data:

```sh
docker compose -f docker/local/compose.yml down
docker compose -f docker/local/compose.yml down -v
```

The named `kata-local-data` volume keeps the demo workspace between restarts.
To start from scratch, stop the stack and remove that volume:

```sh
docker compose -f docker/local/compose.yml down -v
```

Set `KATA_LOCAL_PORT` before running the script to use another local port.
