from fastapi import FastAPI

app = FastAPI(title="${{ values.repoName }}", version="0.1.0")


@app.get("/")
def root() -> dict:
    return {"message": "Hello from ${{ values.repoName }}"}


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}