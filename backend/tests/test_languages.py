from fastapi.testclient import TestClient

from app.core.languages import all_languages, is_supported


def test_languages_endpoint_lists_supported_languages(client: TestClient) -> None:
    response = client.get("/api/languages")

    assert response.status_code == 200
    languages = response.json()["languages"]
    codes = [lang["code"] for lang in languages]
    assert "en" in codes and "te" in codes and "hi" in codes
    assert all(set(lang) == {"code", "name", "native_name"} for lang in languages)


def test_languages_are_sorted_by_english_name() -> None:
    names = [lang.name for lang in all_languages()]
    assert names == sorted(names)


def test_language_codes_are_unique() -> None:
    codes = [lang.code for lang in all_languages()]
    assert len(codes) == len(set(codes))


def test_native_names_are_present() -> None:
    telugu = next(lang for lang in all_languages() if lang.code == "te")
    assert telugu.native_name == "తెలుగు"


def test_is_supported() -> None:
    assert is_supported("en")
    assert not is_supported("xx")
