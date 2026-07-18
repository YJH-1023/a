"""사용자가 지정한 범위의 강좌를 JSON으로 저장하는 명시적 수집 명령.

전 학과를 기본값으로 긁지 않는다. 사용자가 고른 학과·교양 영역만 세션 단위로 처리해
공개 강좌 데이터의 상시 미러링을 피한다.
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Callable, Iterable
from datetime import UTC, datetime
from pathlib import Path

from skku_scraper.client import fetch_elective_courses, fetch_major_courses
from skku_scraper.models import Course, CourseSource

ApiFetcher = Callable[[int, int, str, int], list[dict[str, str]]]


def collect_courses(
    *,
    year: int,
    term: int,
    campus_gb: int,
    department_codes: Iterable[str] = (),
    elective_area_codes: Iterable[str] = (),
    request_interval: float = 0.5,
    major_fetcher: Callable[..., list[dict[str, str]]] = fetch_major_courses,
    elective_fetcher: Callable[..., list[dict[str, str]]] = fetch_elective_courses,
) -> list[Course]:
    """선택한 전공·교양 영역을 조회해 중복 없는 ``Course`` 목록으로 만든다."""
    collected: dict[str, Course] = {}

    for code in department_codes:
        _add_courses(
            collected,
            major_fetcher(year, term, code, campus_gb, request_interval=request_interval),
            source="major",
        )
    for code in elective_area_codes:
        _add_courses(
            collected,
            elective_fetcher(year, term, code, campus_gb, request_interval=request_interval),
            source="elective",
        )

    return list(collected.values())


def write_collection(path: Path, courses: list[Course]) -> None:
    """수집 시각과 최소 과목 필드만 포함한 JSON을 명시한 경로에 저장한다."""
    payload = {
        "generated_at": datetime.now(UTC).isoformat(),
        "courses": [course.to_dict() for course in courses],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _add_courses(
    collected: dict[str, Course], rows: list[dict[str, str]], *, source: CourseSource
) -> None:
    for row in rows:
        course = Course.from_api_row(row, source=source)
        if course.course_id:
            collected.setdefault(course.course_id, course)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="선택한 성균관대 강좌 범위를 JSON으로 저장합니다.")
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--term", type=int, required=True)
    parser.add_argument("--campus", type=int, choices=(1, 2), required=True)
    parser.add_argument(
        "--department", action="append", default=[], help="학과코드 (여러 번 지정 가능)"
    )
    parser.add_argument(
        "--elective-area", action="append", default=[], help="교양 영역코드 (여러 번 지정 가능)"
    )
    parser.add_argument("--output", type=Path, required=True, help="저장할 JSON 경로")
    parser.add_argument("--request-interval", type=float, default=0.5)
    args = parser.parse_args()
    if not args.department and not args.elective_area:
        parser.error("--department 또는 --elective-area를 하나 이상 지정해야 합니다.")
    if args.request_interval < 0:
        parser.error("--request-interval은 0 이상이어야 합니다.")
    return args


def main() -> None:
    """CLI 진입점."""
    args = _parse_args()
    courses = collect_courses(
        year=args.year,
        term=args.term,
        campus_gb=args.campus,
        department_codes=args.department,
        elective_area_codes=args.elective_area,
        request_interval=args.request_interval,
    )
    write_collection(args.output, courses)
    print(f"{len(courses)}개 강좌를 {args.output}에 저장했습니다.")


if __name__ == "__main__":
    main()
