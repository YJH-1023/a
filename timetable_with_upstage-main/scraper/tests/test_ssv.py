import pytest

from skku_scraper.ssv import RS, US, SSVError, parse_ssv


def _join(*records: str) -> str:
    return RS.join(records)


def test_parses_single_row_dataset():
    text = _join(
        "SSV:UTF-8",
        "ErrorCode:int=0",
        "ErrorMsg:string=SUCCESS",
        "Dataset:dsGrdMain",
        US.join(["_RowType_", "GWAMOK_NAME", "PER_NAME"]),
        US.join(["N", "영어쓰기", "매튜아담"]),
        US.join(["N", "컴퓨터개론", "홍길동"]),
    )

    result = parse_ssv(text)

    assert result.ok
    assert result.error_code == 0
    assert result.error_msg == "SUCCESS"
    assert result.datasets["dsGrdMain"] == [
        {"GWAMOK_NAME": "영어쓰기", "PER_NAME": "매튜아담"},
        {"GWAMOK_NAME": "컴퓨터개론", "PER_NAME": "홍길동"},
    ]


def test_strips_type_suffix_from_column_names():
    """실서버 응답은 컬럼 정의가 'COLNAME:type(length)' 형태로 온다 (2026-07-13 실측)."""
    text = _join(
        "SSV:UTF-8",
        "ErrorCode:int=0",
        "ErrorMsg:string=SUCCESS",
        "Dataset:dsGrdMain",
        US.join(["_RowType_", "GWAMOK_NAME:string(4000)", "HAKJUM:string(82)"]),
        US.join(["N", "영어쓰기", "3"]),
    )

    result = parse_ssv(text)

    assert result.datasets["dsGrdMain"] == [{"GWAMOK_NAME": "영어쓰기", "HAKJUM": "3"}]


def test_error_response_is_not_ok():
    text = _join("SSV:UTF-8", "ErrorCode:int=-1", "ErrorMsg:string=FAIL")

    result = parse_ssv(text)

    assert not result.ok
    assert result.error_code == -1
    assert result.datasets == {}


def test_missing_error_code_raises():
    text = _join("SSV:UTF-8", "ErrorMsg:string=SUCCESS")

    with pytest.raises(SSVError):
        parse_ssv(text)
