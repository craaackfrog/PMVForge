
from app.services import job_store

def test_create_and_cancel(tmp_path, monkeypatch):
    monkeypatch.setattr(job_store, "_jobs_dir", lambda: tmp_path)
    job_store._jobs.clear()
    job_store._cancel_flags.clear()
    job = job_store.create_job({"message": "hi"})
    jid = job["job_id"]
    assert job_store.get_job(jid)["status"] == "queued"
    job_store.request_cancel(jid)
    assert job_store.is_cancelled(jid)
    assert job_store.get_job(jid)["status"] == "cancelled"
