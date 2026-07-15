#!/usr/bin/env python3
"""한국천문연구원 특일 정보 API로 data/holidays.json을 자동 생성한다."""

from __future__ import annotations

import datetime as dt
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

API_URL = (
    "https://apis.data.go.kr/B090041/openapi/service/"
    "SpcdeInfoService/getRestDeInfo"
)
OUTPUT = Path("data/holidays.json")

CUSTOM_HOLIDAYS = [
    {
        "id": "union-foundation",
        "name": "노동조합 창립기념일",
        "month": 2,
        "day": 3,
        "annual": True,
        "enabled": True,
        "payAsHoliday": True,
        "editable": True,
    },
    {
        "id": "company-foundation",
        "name": "회사 창립기념일",
        "month": 8,
        "day": 2,
        "annual": True,
        "enabled": True,
        "payAsHoliday": True,
        "editable": True,
    },
]


def get_service_key() -> str:
    key = os.environ.get("DATA_GO_KR_SERVICE_KEY", "").strip()
    if not key:
        raise RuntimeError(
            "GitHub Actions Secret DATA_GO_KR_SERVICE_KEY가 없습니다."
        )
    # 공공데이터포털에서 제공하는 Encoding/Decoding 키를 모두 허용한다.
    return urllib.parse.unquote(key)


def fetch_year(year: int, service_key: str) -> list[dict]:
    query = urllib.parse.urlencode(
        {
            "serviceKey": service_key,
            "solYear": str(year),
            "numOfRows": "100",
            "pageNo": "1",
        }
    )
    request = urllib.request.Request(
        f"{API_URL}?{query}",
        headers={"User-Agent": "shiftcalendar-holiday-updater/1.0"},
    )

    last_error: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read()
            root = ET.fromstring(raw)

            result_code = (
                root.findtext(".//resultCode")
                or root.findtext(".//returnAuthMsg")
                or ""
            )
            if result_code and result_code not in {"00", "NORMAL_SERVICE"}:
                message = root.findtext(".//resultMsg") or result_code
                raise RuntimeError(f"API 오류: {message}")

            items: list[dict] = []
            for item in root.findall(".//item"):
                locdate = (item.findtext("locdate") or "").strip()
                name = (item.findtext("dateName") or "").strip()
                is_holiday = (item.findtext("isHoliday") or "Y").strip()
                if len(locdate) != 8 or not name or is_holiday != "Y":
                    continue
                date_key = f"{locdate[:4]}-{locdate[4:6]}-{locdate[6:]}"
                items.append({"date": date_key, "name": name})
            return items
        except Exception as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"{year}년 공휴일 조회 실패: {last_error}")


def select_major_days(holidays: dict[str, str]) -> list[str]:
    """설날·추석 연휴 중 음력 당일을 자동 선택한다.

    특일 API가 3일 모두 같은 이름으로 반환하는 경우,
    연속된 날짜 묶음의 가운데 날짜를 음력 당일로 선택한다.
    """
    result: list[str] = []

    for keyword in ("설날", "추석"):
        dates = sorted(
            dt.date.fromisoformat(date_key)
            for date_key, name in holidays.items()
            if keyword in name
        )
        groups: list[list[dt.date]] = []
        for date in dates:
            if not groups or (date - groups[-1][-1]).days > 1:
                groups.append([date])
            else:
                groups[-1].append(date)

        for group in groups:
            # 보통 전날·당일·다음날 3일이므로 가운데 날짜가 음력 당일이다.
            chosen = group[len(group) // 2]
            result.append(chosen.isoformat())

    return sorted(set(result))


def main() -> int:
    key = get_service_key()
    current_year = dt.date.today().year
    years = list(range(current_year - 1, current_year + 3))

    holidays: dict[str, str] = {}
    for year in years:
        for item in fetch_year(year, key):
            holidays[item["date"]] = item["name"]

    if not holidays:
        raise RuntimeError("API에서 공휴일을 한 건도 받지 못했습니다.")

    major_days = select_major_days(holidays)
    payload = {
        "schemaVersion": 2,
        "version": dt.datetime.now(dt.timezone.utc).strftime("%Y.%m.%d.%H%M"),
        "updatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "generatedBy": "GitHub Actions + 한국천문연구원 특일 정보 API",
        "sourceName": "한국천문연구원 특일 정보 API",
        "sourceUrl": "https://www.data.go.kr/data/15012690/openapi.do",
        "years": years,
        "holidays": dict(sorted(holidays.items())),
        "majorDays": major_days,
        "customHolidays": CUSTOM_HOLIDAYS,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"{len(holidays)}개 공휴일, 명절 당일 {len(major_days)}개 저장: "
        f"{years[0]}~{years[-1]}"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"업데이트 실패: {exc}", file=sys.stderr)
        raise SystemExit(1)
