# scraper/

성균관대 개설강좌 수집기. 서비스의 조연(시딩용) — 심장은 `web/`의 Upstage 파싱 파이프라인.

API 명세는 `../docs/02_기술검증_기록.md` 참조.

## 개발

```bash
pip install -e ".[dev]"
ruff check .
ruff format --check .
pytest
```

## 선택 범위 수집

전 학과를 기본값으로 수집하지 않는다. 필요한 학과·교양 영역만 명시해 JSON으로 저장한다.
수집 결과는 `.gitignore`에 따라 `data/*.json`으로 두면 커밋되지 않는다.

학과 목록 자체가 필요하면 `skku_scraper.codes.load_departments(year, term)`를 사용한다.
이 함수는 참고 파일의 126개 시드 대신 학과목록 API를 22개 대학코드에 순차 호출해 최신 목록을 읽는다.

```bash
python -m skku_scraper.collect --year 2026 --term 10 --campus 1 \
  --department 316901 --department 316801 --elective-area GEDG001 \
  --output data/selected-courses.json
```

`--campus 1`은 인문사회, `--campus 2`는 자연과학이다. 다른 캠퍼스 학과는 별도로 실행한다.
# 공개 학과·교과과정 조회

성균관대 대표 홈페이지의 `학과/교과목 검색`을 통해 사용자가 지정한 학과·전공·융합트랙만 조회한다.
검색 결과에서 받은 대학·학과 코드를 두 번째 명령에 사용한다. 전체 교육과정은 상시 미러링하지 않는다.

```bash
python -m skku_scraper.curriculum search "경영학과"
python -m skku_scraper.curriculum courses --college-code 3169 --department-code 316901
```
