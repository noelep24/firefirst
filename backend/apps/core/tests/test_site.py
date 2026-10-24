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


def test_department_logo(client, client_for, admin_user, member):
    import base64

    url = "/api/v1/department/"
    admin = client_for(admin_user)
    image = b"\x89PNG\r\n\x1a\n" + b"0" * 64
    png = "data:image/png;base64," + base64.b64encode(image).decode()
    saved = admin.patch(url, {"logo": png}, format="json").json()
    assert "logo" not in saved
    # Profiles carry a link to the image, not the image itself.
    me = client_for(member).get("/api/v1/me/").json()["department"]
    assert me["logo_url"] == saved["logo_url"]
    assert "logo" not in me
    # The link serves the image to anyone (an <img> tag sends no token), cached until the image changes.
    response = client.get(me["logo_url"])
    assert (response.status_code, response["Content-Type"], response.content) == (200, "image/png", image)
    assert "immutable" in response["Cache-Control"]
    assert client.get("/api/v1/departments/nope/logo/").status_code == 404

    # Not an image type we accept (SVG can carry script), not base64, or too big.
    svg = "data:image/svg+xml;base64," + base64.b64encode(b"<svg/>").decode()
    assert admin.patch(url, {"logo": svg}, format="json").status_code == 400
    assert admin.patch(url, {"logo": "data:image/png;base64,***"}, format="json").status_code == 400
    big = "data:image/png;base64," + base64.b64encode(b"0" * (513 * 1024)).decode()
    assert admin.patch(url, {"logo": big}, format="json").status_code == 400
    assert admin.patch(url, {"logo": ""}, format="json").json()["logo_url"] is None
    assert client.get(me["logo_url"]).status_code == 404
    # Saving other settings leaves the logo alone.
    admin.patch(url, {"logo": png}, format="json")
    assert admin.patch(url, {"name": "Renamed"}, format="json").json()["logo_url"] == me["logo_url"]
