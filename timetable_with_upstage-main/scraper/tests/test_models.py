from skku_scraper.models import Course


def test_course_normalizes_api_row_to_required_fields():
    course = Course.from_api_row(
        {
            "GAESUL_YEAR": "2026",
            "GAESUL_TERM": "10",
            "HAKSU_NO_BUNBAN": "GEDG001-41",
            "GWAMOK_NAME": "영어쓰기",
            "HAKJUM": "2",
            "PER_NAME": "홍길동",
            "INTRO_URL": "https://lcms.skku.edu/em/example",
        },
        source="elective",
    )

    assert course.course_number == "GEDG001"
    assert course.section == "41"
    assert course.year == 2026
    assert course.syllabus_url == "https://lcms.skku.edu/em/example"
    assert course.to_dict()["source"] == "elective"


def test_course_tolerates_missing_optional_api_fields():
    course = Course.from_api_row({"HAKSU_NO": "ABC123", "GWAMOK_NAME": "테스트"}, source="major")

    assert course.course_id == ""
    assert course.course_number == "ABC123"
    assert course.year == 0
