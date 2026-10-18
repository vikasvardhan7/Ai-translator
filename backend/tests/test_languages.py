import pytest

from app.core.languages import language_code


@pytest.mark.parametrize(
    ("value", "code"),
    [("te", "te"), ("YUE", "yue"), (" pt-BR ", "pt"), ("zh_Hant", "zh"), ("fil", "fil")],
)
def test_language_codes_are_normalized(value: str, code: str) -> None:
    assert language_code(value) == code


@pytest.mark.parametrize("value", ["", "t", "Telugu", "te1", "12", "-te"])
def test_text_that_is_not_a_code_is_refused(value: str) -> None:
    assert language_code(value) is None
