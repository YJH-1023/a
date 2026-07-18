import json

from skku_scraper.collect import collect_courses, write_collection


def _row(course_id: str, name: str) -> dict[str, str]:
    return {
        "GAESUL_YEAR": "2026",
        "GAESUL_TERM": "10",
        "HAKSU_NO_BUNBAN": course_id,
        "GWAMOK_NAME": name,
    }


def test_collects_selected_sources_and_deduplicates_course_ids():
    major_calls: list[str] = []
    elective_calls: list[str] = []

    def fetch_major(year: int, term: int, code: str, campus: int, **_kwargs: float):
        major_calls.append(f"{year}-{term}-{code}-{campus}")
        return [_row("AAA100-01", "전공")]

    def fetch_elective(year: int, term: int, code: str, campus: int, **_kwargs: float):
        elective_calls.append(f"{year}-{term}-{code}-{campus}")
        return [_row("AAA100-01", "중복"), _row("GEDG001-41", "영어쓰기")]

    courses = collect_courses(
        year=2026,
        term=10,
        campus_gb=1,
        department_codes=["316901"],
        elective_area_codes=["GEDG001"],
        request_interval=0,
        major_fetcher=fetch_major,
        elective_fetcher=fetch_elective,
    )

    assert major_calls == ["2026-10-316901-1"]
    assert elective_calls == ["2026-10-GEDG001-1"]
    assert [(course.course_id, course.source) for course in courses] == [
        ("AAA100-01", "major"),
        ("GEDG001-41", "elective"),
    ]


def test_write_collection_stores_only_normalized_course_fields(tmp_path):
    courses = collect_courses(
        year=2026,
        term=10,
        campus_gb=1,
        department_codes=["316901"],
        request_interval=0,
        major_fetcher=lambda *_args, **_kwargs: [_row("BUS101-01", "경영학")],
    )
    path = tmp_path / "courses.json"

    write_collection(path, courses)

    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["courses"] == [courses[0].to_dict()]
    assert "generated_at" in payload
