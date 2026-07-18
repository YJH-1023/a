from unittest.mock import patch

import pytest

from skku_scraper import client


def _fake_ssv_response(dataset_name: str) -> str:
    return "\x1e".join(
        [
            "SSV:UTF-8",
            "ErrorCode:int=0",
            "ErrorMsg:string=SUCCESS",
            f"Dataset:{dataset_name}",
            "\x1f".join(["_RowType_", "GWAMOK_NAME", "PER_NAME"]),
            "\x1f".join(["N", "경영정보시스템", "홍길동"]),
        ]
    )


class _FakeResponse:
    def __init__(self, text: str):
        self.text = text

    def raise_for_status(self) -> None:
        pass


@pytest.fixture(autouse=True)
def _isolated_session():
    """세션 상태를 테스트마다 초기화한다. 기본값은 '이미 로그인됨'으로 둬서
    각 테스트가 sessionLogin.do 호출까지 신경 쓰지 않아도 되게 한다."""
    client.reset_session()
    client._session_logged_in = True
    yield
    client.reset_session()


def test_fetch_major_courses_parses_rows():
    fake_response = _FakeResponse(_fake_ssv_response("dsGrdMain"))
    with patch.object(client._session, "post", return_value=fake_response) as post:
        rows = client.fetch_major_courses(2026, 20, "316901", 1, request_interval=0)

    assert rows == [{"GWAMOK_NAME": "경영정보시스템", "PER_NAME": "홍길동"}]
    body = post.call_args.kwargs["data"].decode("utf-8")
    assert body.startswith("SSV:utf-8\x1e")  # 없으면 세션 있어도 0행 (2026-07-13 실측)
    assert "HAKGWA_CD=316901" in body
    assert "_TRANSACTION_ID=selectMain" in body
    assert "ROAD_MAP=%" in body  # % 리터럴 유지 (URL 인코딩되면 %25가 되어 0행 원인)


def test_fetch_elective_courses_parses_rows():
    fake_response = _FakeResponse(_fake_ssv_response("dsGrdMain03"))
    with patch.object(client._session, "post", return_value=fake_response) as post:
        rows = client.fetch_elective_courses(2026, 10, "GEDG001", 2, request_interval=0)

    assert rows == [{"GWAMOK_NAME": "경영정보시스템", "PER_NAME": "홍길동"}]
    body = post.call_args.kwargs["data"].decode("utf-8")
    assert "HAKSU_NO=GEDG001" in body


def test_fetch_department_codes_parses_rows():
    fake_response = _FakeResponse(_fake_ssv_response("dsHakgwa"))
    with patch.object(client._session, "post", return_value=fake_response) as post:
        rows = client.fetch_department_codes(2026, 10, "3169", request_interval=0)

    assert rows == [{"GWAMOK_NAME": "경영정보시스템", "PER_NAME": "홍길동"}]
    body = post.call_args.kwargs["data"].decode("utf-8")
    assert "TONG_HAKBU=3169" in body
    assert "_TRANSACTION_ID=selectBizType04" in body


def test_error_code_raises():
    error_text = "\x1e".join(["SSV:UTF-8", "ErrorCode:int=-1", "ErrorMsg:string=FAIL"])
    with (
        patch.object(client._session, "post", return_value=_FakeResponse(error_text)),
        pytest.raises(client.SkkuApiError),
    ):
        client.fetch_major_courses(2026, 20, "316901", 1, request_interval=0)


def test_ensure_session_logs_in_once():
    client.reset_session()
    login_response = _FakeResponse(_fake_ssv_response("gdsUser"))
    with patch.object(client._session, "post", return_value=login_response) as post:
        client._ensure_session()
        client._ensure_session()

    assert post.call_count == 1
    assert post.call_args.args[0] == client.SESSION_LOGIN_ENDPOINT
    assert client._session_logged_in is True


def test_fetch_triggers_session_login_when_not_logged_in():
    client.reset_session()
    login_response = _FakeResponse(_fake_ssv_response("gdsUser"))
    data_response = _FakeResponse(_fake_ssv_response("dsGrdMain"))
    with patch.object(client._session, "post", side_effect=[login_response, data_response]) as post:
        rows = client.fetch_major_courses(2026, 20, "316901", 1, request_interval=0)

    assert rows == [{"GWAMOK_NAME": "경영정보시스템", "PER_NAME": "홍길동"}]
    assert post.call_count == 2
    assert post.call_args_list[0].args[0] == client.SESSION_LOGIN_ENDPOINT
    assert post.call_args_list[1].args[0] == client.MAJOR_ENDPOINT
