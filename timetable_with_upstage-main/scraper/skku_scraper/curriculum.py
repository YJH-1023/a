"""성균관대 대표 홈페이지의 공개 학과·교과과정 검색 클라이언트.

대표 홈페이지가 제공하는 중앙 검색 경로를 사용해 사용자가 조회한 학과·전공·트랙만 가져온다.
학과별 홈페이지를 개별 크롤링하거나 전체 교과과정을 상시 미러링하지 않는다.
"""

from __future__ import annotations

import argparse
import json
import re
import time
from dataclasses import asdict, dataclass
from html.parser import HTMLParser

import requests

DEPARTMENT_SEARCH_URL = "https://www.skku.edu/skku/edu/bachelor/curriculum.do"
CURRICULUM_URL = "https://www.skku.edu/skku/popup/curriculum_popup.do"
DEFAULT_REQUEST_INTERVAL_SECONDS = 0.5

_HEADERS = {
    "Accept": "text/html,application/xhtml+xml",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
}


class CurriculumError(Exception):
    """공개 교과과정 페이지를 조회하거나 해석하지 못했을 때."""


@dataclass(frozen=True, slots=True)
class CurriculumDepartment:
    """대표 홈페이지 검색 결과의 학사과정 학과·전공·트랙."""

    name: str
    college_code: str
    department_code: str
    homepage: str
    phone: str


@dataclass(frozen=True, slots=True)
class CurriculumCourse:
    """학과별 교육과정 팝업의 최소 교과목 정보."""

    department_name: str
    course_number: str
    name: str
    credits: str
    description: str


def search_curriculum_departments(
    query: str,
    *,
    request_interval: float = DEFAULT_REQUEST_INTERVAL_SECONDS,
    session: requests.Session | None = None,
) -> list[CurriculumDepartment]:
    """학사과정 학과·전공·트랙을 이름으로 검색한다."""
    normalized_query = query.strip()
    if not normalized_query:
        raise ValueError("학과·전공·트랙 검색어가 필요합니다.")

    client = session or requests.Session()
    time.sleep(request_interval)
    response = client.get(
        DEPARTMENT_SEARCH_URL,
        params={"srSearchVal": normalized_query},
        headers=_HEADERS,
        timeout=10,
    )
    response.raise_for_status()

    parser = _DepartmentSearchParser()
    parser.feed(response.text)
    return parser.departments


def fetch_curriculum_courses(
    college_code: str,
    department_code: str,
    *,
    request_interval: float = DEFAULT_REQUEST_INTERVAL_SECONDS,
    session: requests.Session | None = None,
) -> list[CurriculumCourse]:
    """선택한 학과·전공·트랙의 공개 교육과정 교과목만 가져온다."""
    if not college_code.isdigit() or not department_code.isdigit():
        raise ValueError("대학·학과 코드는 숫자여야 합니다.")

    client = session or requests.Session()
    time.sleep(request_interval)
    response = client.get(
        CURRICULUM_URL,
        params={
            "mode": "popup",
            # 기본값은 10개라 선택 학과의 교육과정이 조용히 잘리는 것을 막는다.
            "pagerLimit": "1000",
            "srAdminCd": college_code,
            "srHakgwaCd": department_code,
        },
        headers=_HEADERS,
        timeout=10,
    )
    response.raise_for_status()

    parser = _CurriculumCourseParser()
    parser.feed(response.text)
    if not parser.courses:
        raise CurriculumError("선택한 학과의 공개 교육과정 교과목을 찾지 못했습니다.")
    return parser.courses


class _DepartmentSearchParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.departments: list[CurriculumDepartment] = []
        self._heading_parts: list[str] | None = None
        self._section = ""
        self._cells: list[list[str]] | None = None
        self._cell_parts: list[str] | None = None
        self._homepage = ""
        self._codes: tuple[str, str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "h4" and "bullet_tit" in (attributes.get("class") or ""):
            self._heading_parts = []
        elif tag == "tr" and self._section == "대학":
            self._cells = []
            self._homepage = ""
            self._codes = None
        elif tag == "td" and self._cells is not None:
            self._cell_parts = []
        elif tag == "a" and self._cells is not None:
            if "postLink" in (attributes.get("class") or ""):
                homepage = attributes.get("data-link") or attributes.get("href") or ""
                self._homepage = homepage.strip()
            onclick = attributes.get("onclick") or ""
            match = re.search(r"srAdminCd=(\d+).*?srHakgwaCd=(\d+)", onclick)
            if match:
                self._codes = (match.group(1), match.group(2))

    def handle_data(self, data: str) -> None:
        if self._heading_parts is not None:
            self._heading_parts.append(data)
        if self._cell_parts is not None:
            self._cell_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "h4" and self._heading_parts is not None:
            self._section = _clean_text(self._heading_parts)
            self._heading_parts = None
        elif tag == "td" and self._cell_parts is not None and self._cells is not None:
            self._cells.append(self._cell_parts)
            self._cell_parts = None
        elif tag == "tr" and self._cells is not None:
            cells = [_clean_text(parts) for parts in self._cells]
            if len(cells) >= 4 and self._codes:
                self.departments.append(
                    CurriculumDepartment(
                        name=cells[1],
                        college_code=self._codes[0],
                        department_code=self._codes[1],
                        homepage=self._homepage,
                        phone=cells[3],
                    )
                )
            self._cells = None
            self._cell_parts = None


class _CurriculumCourseParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.courses: list[CurriculumCourse] = []
        self._in_course_table = False
        self._cells: list[list[str]] | None = None
        self._cell_parts: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "table" and "board_list" in (attributes.get("class") or ""):
            self._in_course_table = True
        elif tag == "tr" and self._in_course_table:
            self._cells = []
        elif tag == "td" and self._cells is not None:
            self._cell_parts = []

    def handle_data(self, data: str) -> None:
        if self._cell_parts is not None:
            self._cell_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "td" and self._cell_parts is not None and self._cells is not None:
            self._cells.append(self._cell_parts)
            self._cell_parts = None
        elif tag == "tr" and self._cells is not None:
            cells = [_clean_text(parts) for parts in self._cells]
            if len(cells) == 4:
                name_match = re.search(r"\(([^()]*)\)\s*$", cells[1])
                if name_match:
                    self.courses.append(
                        CurriculumCourse(
                            department_name=cells[0],
                            course_number=name_match.group(1).strip(),
                            name=cells[1][: name_match.start()].strip(),
                            description=cells[2],
                            credits=cells[3],
                        )
                    )
            self._cells = None
            self._cell_parts = None
        elif tag == "table" and self._in_course_table:
            self._in_course_table = False


def _clean_text(parts: list[str]) -> str:
    return " ".join("".join(parts).split())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="성균관대 공개 학과·교과과정 조회")
    subparsers = parser.add_subparsers(dest="command", required=True)

    search_parser = subparsers.add_parser("search", help="학과·전공·트랙 검색")
    search_parser.add_argument("query")

    courses_parser = subparsers.add_parser("courses", help="선택 학과의 교과목 조회")
    courses_parser.add_argument("--college-code", required=True)
    courses_parser.add_argument("--department-code", required=True)

    args = parser.parse_args(argv)
    if args.command == "search":
        result = search_curriculum_departments(args.query)
    else:
        result = fetch_curriculum_courses(args.college_code, args.department_code)

    print(json.dumps([asdict(item) for item in result], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
