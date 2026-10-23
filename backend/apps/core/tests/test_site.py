from django.test import override_settings


def test_healthz(client, db):
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_web_app_routes_serve_index(client, tmp_path):
    (tmp_path / "index.html").write_text("<!doctype html><title>FireFirst</title>")
    with override_settings(WEB_DIST=tmp_path):
        for path in ("/", "/apparatus/12", "/schedule"):
            response = client.get(path)
            assert response.status_code == 200
            assert b"FireFirst" in b"".join(response.streaming_content)


def test_web_app_not_built(client, tmp_path):
    with override_settings(WEB_DIST=tmp_path):
        assert client.get("/apparatus").status_code == 404


def test_api_paths_are_not_swallowed_by_the_web_app(client, db):
    assert client.get("/api/v1/nope/").status_code == 404
    assert client.get("/api/v1/me/").status_code in (401, 403)


def test_department_logo(client_for, admin_user, member):
    import base64

    url = "/api/v1/department/"
    client = client_for(admin_user)
    png = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 64).decode()
    assert client.patch(url, {"logo": png}, format="json").json()["logo"] == png
    assert client_for(member).get("/api/v1/me/").json()["department"]["logo"] == png
    # Not an image type we accept (SVG can carry script), not base64, or too big.
    svg = "data:image/svg+xml;base64," + base64.b64encode(b"<svg/>").decode()
    assert client.patch(url, {"logo": svg}, format="json").status_code == 400
    assert client.patch(url, {"logo": "data:image/png;base64,***"}, format="json").status_code == 400
    big = "data:image/png;base64," + base64.b64encode(b"0" * (513 * 1024)).decode()
    assert client.patch(url, {"logo": big}, format="json").status_code == 400
    assert client.patch(url, {"logo": ""}, format="json").json()["logo"] == ""
