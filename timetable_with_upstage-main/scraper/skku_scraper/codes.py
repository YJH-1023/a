"""성대 개설강좌 API 조회에 쓰이는 코드 상수.

명세 출처: ../../docs/02_기술검증_기록.md, ../../docs/성대_학과코드_전체.txt
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

# TERM 코드 (2026학년도 경영학과 실측 기준, ../../docs/02_기술검증_기록.md 참조)
TERM_1ST_SEMESTER = 10
TERM_SUMMER = 15
TERM_2ND_SEMESTER = 20
TERM_WINTER = 25  # 겨울학기는 미개설(0개) 확인됨

# CAMPUS_GB 코드
CAMPUS_HUMANITIES = 1  # 인문사회캠퍼스
CAMPUS_NATURAL_SCIENCE = 2  # 자연과학캠퍼스

_HAKGWA_CODES_PATH = Path(__file__).resolve().parents[2] / "docs" / "성대_학과코드_전체.txt"


@dataclass(frozen=True)
class HakgwaCode:
    code: str
    name: str
    college: str
    college_code: str


@dataclass(frozen=True)
class CollegeCode:
    code: str
    name: str


def load_hakgwa_codes(path: Path = _HAKGWA_CODES_PATH) -> list[HakgwaCode]:
    """탭 구분 학과코드 목록 파일을 읽어 HakgwaCode 리스트로 반환한다.

    데이터 행은 "학과코드\\t학과명\\t소속대학\\t대학코드" 형태만 골라낸다
    (그 외 안내문 줄은 탭 3개 구조가 아니므로 자동으로 걸러진다).
    """
    codes: list[HakgwaCode] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.split("\t")
        if len(parts) != 4:
            continue
        code, name, college, college_code = parts
        if not code.isdigit():
            continue
        codes.append(HakgwaCode(code=code, name=name, college=college, college_code=college_code))
    return codes


def load_college_codes(path: Path = _HAKGWA_CODES_PATH) -> list[CollegeCode]:
    """문서의 대학코드 섹션을 읽어 실시간 학과목록 조회 대상 목록을 반환한다."""
    text = path.read_text(encoding="utf-8")
    try:
        college_section = text.split("■ 대학코드(TONG_HAKBU) 22개", maxsplit=1)[1].split(
            "■ 전체 학과코드", maxsplit=1
        )[0]
    except IndexError as exc:
        raise ValueError("학과코드 문서에서 대학코드 섹션을 찾지 못했습니다") from exc

    return [
        CollegeCode(code=match.group(1), name=match.group(2).strip())
        for match in re.finditer(r"(?<!\d)(\d{4})\s+([^\n/]+)", college_section)
    ]


def load_departments(year: int, term: int, *, request_interval: float = 0.5) -> list[HakgwaCode]:
    """학과목록 API에서 최신 전체 학과를 읽는다.

    파일의 126개 목록은 오프라인 시드·대학명 참고용일 뿐, 학과 신설·변경을 반영하려면
    이 함수를 사용해야 한다. 순차 호출과 기본 요청 간격으로 학교 서버 부담을 낮춘다.
    """
    # 순환 import를 피하고, codes.py 자체는 파일 시드만 읽을 수 있게 둔다.
    from skku_scraper.client import fetch_department_codes

    departments: dict[str, HakgwaCode] = {}
    for college in load_college_codes():
        rows = fetch_department_codes(year, term, college.code, request_interval=request_interval)
        for row in rows:
            code = row.get("COM_CD", "")
            if not code:
                continue
            departments.setdefault(
                code,
                HakgwaCode(
                    code=code,
                    name=row.get("CD_NM", ""),
                    college=college.name,
                    college_code=college.code,
                ),
            )
    return list(departments.values())
