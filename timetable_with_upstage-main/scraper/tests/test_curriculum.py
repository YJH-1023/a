from unittest.mock import Mock

import pytest

from skku_scraper.curriculum import (
    CurriculumError,
    fetch_curriculum_courses,
    search_curriculum_departments,
)


def _response(html: str) -> Mock:
    response = Mock()
    response.text = html
    response.raise_for_status.return_value = None
    return response


def test_search_curriculum_departments_returns_only_undergraduate_results():
    html = """
    <h4 class="bullet_tit">대학</h4>
    <table><tbody><tr>
      <td>1</td><td>경영학과</td>
      <td><a class="postLink" data-link="https://example.edu/biz/">홈페이지</a></td>
      <td>02-760-0000</td>
      <td><a onclick="window.open('/popup?srAdminCd=3169&amp;srHakgwaCd=316901')">과정</a></td>
    </tr></tbody></table>
    <h4 class="bullet_tit">일반대학원</h4>
    <table><tbody><tr>
      <td>1</td><td>대학원 경영학과</td><td></td><td></td>
      <td><a onclick="window.open('/popup?srAdminCd=9999&amp;srHakgwaCd=999999')">과정</a></td>
    </tr></tbody></table>
    """
    session = Mock()
    session.get.return_value = _response(html)

    result = search_curriculum_departments("경영", request_interval=0, session=session)

    assert len(result) == 1
    assert result[0].name == "경영학과"
    assert result[0].college_code == "3169"
    assert result[0].department_code == "316901"
    assert result[0].homepage == "https://example.edu/biz/"
    session.get.assert_called_once()
    assert session.get.call_args.kwargs["params"] == {"srSearchVal": "경영"}


def test_fetch_curriculum_courses_parses_course_rows():
    html = """
    <table class="board_list"><thead><tr><th>학과명</th></tr></thead><tbody>
      <tr>
        <td>경영학과</td><td>관리회계 (BIZ2021)</td>
        <td> 원가 정보를 배우는 과목입니다. </td><td>3</td>
      </tr>
      <tr>
        <td>경영학과</td><td>회계원리\n(BIZ2022)</td>
        <td> 회계의 기본 개념을 배웁니다. </td><td>3</td>
      </tr>
    </tbody></table>
    """
    session = Mock()
    session.get.return_value = _response(html)

    result = fetch_curriculum_courses("3169", "316901", request_interval=0, session=session)

    assert [course.course_number for course in result] == ["BIZ2021", "BIZ2022"]
    assert result[0].name == "관리회계"
    assert result[0].credits == "3"
    assert result[0].description == "원가 정보를 배우는 과목입니다."
    assert session.get.call_args.kwargs["params"]["srHakgwaCd"] == "316901"
    assert session.get.call_args.kwargs["params"]["pagerLimit"] == "1000"


def test_curriculum_requires_numeric_codes_and_nonempty_results():
    with pytest.raises(ValueError, match="숫자"):
        fetch_curriculum_courses("college", "316901", request_interval=0)

    session = Mock()
    session.get.return_value = _response("<table class='board_list'></table>")
    with pytest.raises(CurriculumError, match="찾지 못했습니다"):
        fetch_curriculum_courses("3169", "316901", request_interval=0, session=session)
