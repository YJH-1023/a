"""넥사크로(Nexacro) SSV 응답 파서.

포맷 명세는 ../../docs/02_기술검증_기록.md 및 05번 절(넥사크로 기술 메모) 참조.
레코드 구분자 RS(0x1e)로 줄을 나누고, 각 데이터 레코드는 컬럼 구분자 US(0x1f)로 값을 나눈다.
데이터셋 헤더는 "_RowType_" 뒤에 컬럼명이 오고, 데이터 행은 첫 값이 행타입(N=정상 등)이라
컬럼명과 매칭할 때는 건너뛴다.
"""

from __future__ import annotations

from dataclasses import dataclass, field

RS = "\x1e"
US = "\x1f"


class SSVError(Exception):
    """SSV 응답 파싱 실패."""


@dataclass
class SSVResponse:
    error_code: int
    error_msg: str
    datasets: dict[str, list[dict[str, str]]] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.error_code == 0


def parse_ssv(text: str) -> SSVResponse:
    """SSV 응답 문자열을 파싱해 ErrorCode·데이터셋별 행 목록으로 변환한다."""
    error_code: int | None = None
    error_msg = ""
    datasets: dict[str, list[dict[str, str]]] = {}

    current_dataset: str | None = None
    columns: list[str] = []

    for record in text.split(RS):
        if not record:
            continue
        if record.startswith("ErrorCode:"):
            error_code = int(record.rsplit("=", 1)[1])
        elif record.startswith("ErrorMsg:"):
            error_msg = record.split("=", 1)[1]
        elif record.startswith("Dataset:"):
            current_dataset = record.split(":", 1)[1]
            datasets[current_dataset] = []
            columns = []
        elif record.startswith("_RowType_"):
            # 컬럼 정의는 "COLNAME:type(length)" 형태 → 이름만 남긴다.
            columns = [col.split(":", 1)[0] for col in record.split(US)[1:]]
        elif current_dataset is not None and columns:
            values = record.split(US)[1:]
            datasets[current_dataset].append(dict(zip(columns, values, strict=False)))

    if error_code is None:
        raise SSVError("SSV 응답에 ErrorCode 레코드가 없음 — 형식이 예상과 다름")

    return SSVResponse(error_code=error_code, error_msg=error_msg, datasets=datasets)
