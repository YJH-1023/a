"""수집 결과를 서비스에 넘기기 위한 최소 과목 모델.

원본 API 응답 전체를 저장하지 않는다. 시간표·강의계획서 파싱에 필요한 필드만 남겨
공개 강좌 데이터를 상시 미러링하지 않는 프로젝트 안전선을 지킨다.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal

CourseSource = Literal["major", "elective"]


@dataclass(frozen=True, slots=True)
class Course:
    """시간표 조합과 강의계획서 파싱에 필요한 강좌 정보."""

    source: CourseSource
    year: int
    term: int
    course_id: str
    course_number: str
    section: str
    name: str
    english_name: str
    credits: str
    professor: str
    schedule: str
    location: str
    classification: str
    course_type: str
    campus: str
    syllabus_url: str

    @classmethod
    def from_api_row(cls, row: dict[str, str], *, source: CourseSource) -> Course:
        """성대 API 한 행을 서비스용 최소 모델로 정규화한다."""
        course_id = row.get("HAKSU_NO_BUNBAN", "")
        course_number, separator, section = course_id.partition("-")
        if not separator:
            course_number = row.get("HAKSU_NO", course_id)

        return cls(
            source=source,
            year=_as_int(row.get("GAESUL_YEAR")),
            term=_as_int(row.get("GAESUL_TERM")),
            course_id=course_id,
            course_number=course_number,
            section=section,
            name=row.get("GWAMOK_NAME", ""),
            english_name=row.get("GWAMOK_ENG_NAME", ""),
            credits=row.get("HAKJUM", ""),
            professor=row.get("PER_NAME", ""),
            schedule=row.get("GYOSI_NAME", ""),
            location=row.get("HYUNGTAE", ""),
            classification=row.get("ISU_NAME", ""),
            course_type=row.get("SUUP_TYPE_NM", ""),
            campus=row.get("CAMPUS_NM", ""),
            syllabus_url=row.get("INTRO_URL", ""),
        )

    def to_dict(self) -> dict[str, str | int]:
        """JSON 직렬화에 사용할 사전으로 변환한다."""
        return asdict(self)


def _as_int(value: str | None) -> int:
    """API의 빈 숫자 필드를 JSON에서 일관되게 0으로 표현한다."""
    return int(value) if value and value.isdigit() else 0
