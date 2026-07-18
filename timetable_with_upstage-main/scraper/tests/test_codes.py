from unittest.mock import patch

from skku_scraper.codes import HakgwaCode, load_college_codes, load_departments, load_hakgwa_codes


def test_loads_known_departments():
    codes = load_hakgwa_codes()

    assert len(codes) > 100
    biz = HakgwaCode(code="316901", name="경영학과", college="경영대학", college_code="3169")
    arch = HakgwaCode(code="316307", name="건축학과", college="공과대학", college_code="3163")
    assert biz in codes
    assert arch in codes


def test_all_entries_have_digit_codes():
    codes = load_hakgwa_codes()

    assert all(c.code.isdigit() for c in codes)


def test_loads_all_documented_college_codes():
    colleges = load_college_codes()

    assert len(colleges) == 22
    assert colleges[0].code == "3169"
    assert colleges[-1].name == "학부대학"


def test_load_departments_uses_live_api_rows_as_source_of_truth():
    def fake_fetch(year: int, term: int, college_code: str, **_kwargs: float):
        assert (year, term) == (2026, 10)
        if college_code == "3169":
            return [{"COM_CD": "316999", "CD_NM": "신설학과"}]
        return []

    with patch("skku_scraper.client.fetch_department_codes", side_effect=fake_fetch) as fetch:
        departments = load_departments(2026, 10, request_interval=0)

    assert fetch.call_count == 22
    assert departments == [
        HakgwaCode(code="316999", name="신설학과", college="경영대학", college_code="3169")
    ]
