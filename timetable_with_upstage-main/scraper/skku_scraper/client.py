"""성대 개설강좌 API 클라이언트 (전공/교양).

명세 출처: ../../docs/02_기술검증_기록.md "방법 A: 순수 API 직접호출".
요청 간격을 두어 서버 부담을 줄인다 (../../docs/04_규칙과_지켜야할것.md 데이터 안전선).

selectMain.do는 유효한 세션(JSESSIONID)이 없으면 ErrorCode:int=0(성공)인데도 데이터가 0행으로
온다. 그래서 실제 조회 전에 sessionLogin.do를 한 번 호출해 세션을 성립시킨 뒤, 같은 Session으로
이어서 조회한다.

★ P3-a 블로커 해소 (2026-07-13 라이브 검증 완료): 세션을 맞춰도 여전히 0행이던 진짜 원인은
바디 맨 앞에 "SSV:utf-8" 레코드가 빠져있었던 것. `_build_ssv_body`가 이를 자동으로 붙인다.
실측: 경영학과(316901) TERM=10 → 103행(그중 42행에 INTRO_URL 채워짐), TERM=20 → 107행.
"""

from __future__ import annotations

import time

import requests

from skku_scraper.ssv import RS, SSVError, SSVResponse, parse_ssv

BASE_URL = "https://kingoinfo.skku.edu/gaia"
SESSION_LOGIN_ENDPOINT = f"{BASE_URL}/E_NCommon/sessionLogin.do"
MAJOR_ENDPOINT = f"{BASE_URL}/E_NHSSU900020M/selectMain.do"
ELECTIVE_ENDPOINT = f"{BASE_URL}/E_NHSSU900010M/selectMain03.do"
DEPARTMENT_ENDPOINT = f"{BASE_URL}/E_NHSSU900020M/selectBizType04.do"

_HEADERS = {
    "Content-Type": "text/xml",
    "Accept": "application/xml, text/xml, */*",
    "X-Requested-With": "XMLHttpRequest",
    "X-NX-Content-Type": "2",
    "Cache-Control": "no-cache",
    # 기본 python-requests UA는 서버가 404/커넥션리셋으로 거부함 (2026-07-13 실측).
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Referer": "https://kingoinfo.skku.edu/gaia/nxui/outdex.html?language=KO&menuId=NHSSU030840M",
    "Origin": "https://kingoinfo.skku.edu",
}

DEFAULT_REQUEST_INTERVAL_SECONDS = 0.5

_session = requests.Session()
_session.headers.update(_HEADERS)
_session_logged_in = False


class SkkuApiError(Exception):
    """성대 API가 ErrorCode!=0을 반환했을 때."""


def _build_ssv_body(**params: str) -> str:
    """Nexacro SSV 요청 바디를 만든다.

    맨 앞에 "SSV:utf-8" 레코드가 반드시 있어야 한다 — 이게 없으면 세션이 있어도
    ErrorCode:0 + 데이터 0행이 돌아온다 (docs/02_기술검증_기록.md 실측, 2026-07-13 재확인).
    """
    records = ["SSV:utf-8", *(f"{key}={value}" for key, value in params.items())]
    return RS.join(records) + RS


def _ensure_session() -> None:
    """sessionLogin.do로 JSESSIONID를 성립시킨다. 이미 성립됐으면 아무것도 안 한다."""
    global _session_logged_in
    if _session_logged_in:
        return
    resp = _session.post(SESSION_LOGIN_ENDPOINT, data=f"SSV:utf-8{RS}".encode(), timeout=10)
    resp.raise_for_status()
    _session_logged_in = True


def reset_session() -> None:
    """세션을 강제로 새로 시작한다 (테스트용, 또는 장시간 실행 중 세션 만료 대응용)."""
    global _session_logged_in
    _session_logged_in = False


def _post(endpoint: str, **params: str) -> SSVResponse:
    _ensure_session()
    body = _build_ssv_body(**params)
    resp = _session.post(endpoint, data=body.encode("utf-8"), timeout=10)
    resp.raise_for_status()
    try:
        parsed = parse_ssv(resp.text)
    except SSVError as exc:
        raise SkkuApiError(f"SSV 파싱 실패: {exc}") from exc
    if not parsed.ok:
        raise SkkuApiError(f"성대 API 오류 (ErrorCode={parsed.error_code}): {parsed.error_msg}")
    return parsed


def fetch_major_courses(
    year: int,
    term: int,
    hakgwa_cd: str,
    campus_gb: int,
    *,
    request_interval: float = DEFAULT_REQUEST_INTERVAL_SECONDS,
) -> list[dict[str, str]]:
    """전공과목을 조회한다. 응답 데이터셋명은 dsGrdMain."""
    time.sleep(request_interval)
    result = _post(
        MAJOR_ENDPOINT,
        YEAR=str(year),
        TERM=str(term),
        HAKGWA_CD=hakgwa_cd,
        CAMPUS_GB=str(campus_gb),
        ROAD_MAP="%",
        HAK_JIBJUNG="0",
        _FIRST_OUT_DS_NM="dsGrdMain",
        _TRANSACTION_ID="selectMain",
    )
    return result.datasets.get("dsGrdMain", [])


def fetch_elective_courses(
    year: int,
    term: int,
    haksu_no: str,
    campus_gb: int,
    *,
    request_interval: float = DEFAULT_REQUEST_INTERVAL_SECONDS,
) -> list[dict[str, str]]:
    """교양과목을 영역코드(haksu_no)로 조회한다. 응답 데이터셋명은 dsGrdMain03."""
    time.sleep(request_interval)
    result = _post(
        ELECTIVE_ENDPOINT,
        YEAR=str(year),
        TERM=str(term),
        HAKSU_NO=haksu_no,
        CAMPUS_GB=str(campus_gb),
        ROAD_MAP="%",
        HAK_JIBJUNG="0",
        _FIRST_OUT_DS_NM="dsGrdMain03",
        _TRANSACTION_ID="selectMain03",
    )
    return result.datasets.get("dsGrdMain03", [])


def fetch_department_codes(
    year: int,
    term: int,
    college_code: str,
    *,
    request_interval: float = DEFAULT_REQUEST_INTERVAL_SECONDS,
) -> list[dict[str, str]]:
    """대학코드에 속한 최신 학과 목록을 조회한다. 응답 데이터셋명은 dsHakgwa."""
    time.sleep(request_interval)
    result = _post(
        DEPARTMENT_ENDPOINT,
        JOJIK_GB="31",
        TONG_HAKBU=college_code,
        YEAR=str(year),
        TERM=str(term),
        _FIRST_OUT_DS_NM="dsHakgwa",
        _TRANSACTION_ID="selectBizType04",
    )
    return result.datasets.get("dsHakgwa", [])
