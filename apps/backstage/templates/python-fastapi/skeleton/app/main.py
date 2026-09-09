from fastapi import FastAPI

app = FastAPI(title="${{ repoName }}", version="0.1.0")


@app.get("/")
def root() -> dict:
    return {"message": "Hello from ${{ repoName }}"}


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}