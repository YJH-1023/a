"use client";

import { toPng } from "html-to-image";
import { type ReactNode, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

import { track } from "@/lib/analytics";
import { SITE_URL } from "@/lib/site-config";
import { mergeMeetingsForDisplay, parseSchedule, type Timetable, type Weekday } from "@/lib/timetable";
import { encodeShareableTimetable } from "@/lib/timetable-share";

import styles from "./TimetablePlanner.module.css";

export const DAYS: ReadonlyArray<{ id: Weekday; label: string }> = [
  { id: "mon", label: "월" },
  { id: "tue", label: "화" },
  { id: "wed", label: "수" },
  { id: "thu", label: "목" },
  { id: "fri", label: "금" },
];

const TIMETABLE_START_MINUTES = 8 * 60;
const TIMETABLE_END_MINUTES = 22 * 60;
const PIXELS_PER_MINUTE = 0.8;

export interface TimetableExtra {
  groupTitle: string;
  title: string;
  classification: string;
}

export function TimetableCard({
  extras,
  footer,
  heading,
  index,
  timetable,
}: {
  extras: readonly TimetableExtra[];
  footer?: ReactNode;
  heading?: string;
  index: number;
  timetable: Timetable;
}) {
  const scheduledCourses = timetable.courses.flatMap((course, courseIndex) =>
    mergeMeetingsForDisplay(parseSchedule(course.schedule)).map((meeting) => ({
      course,
      courseIndex,
      meeting,
    })),
  );
  const unscheduledCourses = timetable.courses.filter(
    (course) => parseSchedule(course.schedule).length === 0,
  );
  const totalCredits = timetable.courses.reduce(
    (credits, course) => credits + (course.credits ?? 0),
    0,
  );
  const versionLabel = describeTimetableVersion(extras);
  const gridRef = useRef<HTMLDivElement>(null);
  const [isSavingImage, setIsSavingImage] = useState(false);
  const [saveImageError, setSaveImageError] = useState("");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  async function handleSaveImage(): Promise<void> {
    if (!gridRef.current || isSavingImage) {
      return;
    }
    setIsSavingImage(true);
    setSaveImageError("");
    try {
      const dataUrl = await toPng(gridRef.current, { backgroundColor: "#ffffff", pixelRatio: 2 });
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `${sanitizeFileName(heading ?? `시간표-조합${index + 1}`)}.png`;
      link.click();
      track("timetable_save");
    } catch {
      setSaveImageError("이미지 저장에 실패했습니다. 다시 시도해 주세요.");
    } finally {
      setIsSavingImage(false);
    }
  }

  function handleToggleShare(): void {
    if (!shareUrl) {
      const encoded = encodeShareableTimetable(timetable);
      setShareUrl(`${SITE_URL}/share/${encoded}`);
      track("share_link_created");
    }
    setIsShareOpen((open) => !open);
    setShareCopied(false);
  }

  async function handleCopyShareLink(): Promise<void> {
    if (!shareUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
    } catch {
      setShareCopied(false);
    }
  }

  return (
    <li className={styles.timetableCard}>
      <details open={index === 0}>
        <summary>
          <span>
            {heading ?? `조합 ${index + 1}`}
            {versionLabel ? <small className={styles.timetableVersion}>{versionLabel}</small> : null}
          </span>
          <small>
            {timetable.courses.length}과목 · {formatCredits(totalCredits)}학점 · 눌러서 시간표{" "}
            {index === 0 ? "접기" : "보기"}
          </small>
        </summary>
        {extras.length > 0 ? (
          <p className={styles.timetableExtras}>
            추가 과목:{" "}
            {extras
              .map((extra) => `${extra.groupTitle} · ${extra.title}(${extra.classification})`)
              .join(", ")}
          </p>
        ) : null}
        <div className={styles.weeklyViewport}>
          <div className={styles.weeklyTimetable} ref={gridRef}>
            <div className={styles.weekHeader}>
              <span aria-hidden="true" />
              {DAYS.map((day) => <strong key={day.id}>{day.label}</strong>)}
            </div>
            <div
              className={styles.weekBody}
              style={{
                height: (TIMETABLE_END_MINUTES - TIMETABLE_START_MINUTES) * PIXELS_PER_MINUTE,
              }}
            >
              {Array.from(
                { length: (TIMETABLE_END_MINUTES - TIMETABLE_START_MINUTES) / 60 + 1 },
                (_, hourIndex) => {
                  const minutes = TIMETABLE_START_MINUTES + hourIndex * 60;
                  const top = (minutes - TIMETABLE_START_MINUTES) * PIXELS_PER_MINUTE;
                  return (
                    <div className={styles.hourLine} key={minutes} style={{ top }}>
                      <span>{formatMinutes(minutes)}</span>
                    </div>
                  );
                },
              )}
              <div className={styles.dayColumns}>
                {DAYS.map((day) => (
                  <div className={styles.dayColumn} key={day.id}>
                    {scheduledCourses
                      .filter(({ meeting }) => meeting.day === day.id)
                      .map(({ course, courseIndex, meeting }) => {
                        const visibleStart = Math.max(meeting.startMinutes, TIMETABLE_START_MINUTES);
                        const visibleEnd = Math.min(meeting.endMinutes, TIMETABLE_END_MINUTES);
                        if (visibleStart >= visibleEnd) {
                          return null;
                        }
                        return (
                          <div
                            className={styles.courseBlock}
                            data-color={courseIndex % 6}
                            key={`${course.id}-${meeting.startMinutes}`}
                            style={{
                              top: (visibleStart - TIMETABLE_START_MINUTES) * PIXELS_PER_MINUTE,
                              height: Math.max(28, (visibleEnd - visibleStart) * PIXELS_PER_MINUTE),
                            }}
                            title={`${course.title} · ${formatMinutes(meeting.startMinutes)}-${formatMinutes(meeting.endMinutes)}`}
                          >
                            <strong>{course.title}</strong>
                            <small>{formatMinutes(meeting.startMinutes)}-{formatMinutes(meeting.endMinutes)}</small>
                          </div>
                        );
                      })}
                    {timetable.fixedEvents
                      .filter((event) => event.day === day.id)
                      .map((event) => {
                        const visibleStart = Math.max(event.startMinutes, TIMETABLE_START_MINUTES);
                        const visibleEnd = Math.min(event.endMinutes, TIMETABLE_END_MINUTES);
                        if (visibleStart >= visibleEnd) {
                          return null;
                        }
                        return (
                          <div
                            className={styles.fixedEventBlock}
                            key={event.id}
                            style={{
                              top: (visibleStart - TIMETABLE_START_MINUTES) * PIXELS_PER_MINUTE,
                              height: Math.max(28, (visibleEnd - visibleStart) * PIXELS_PER_MINUTE),
                            }}
                            title={`${event.label} · ${formatMinutes(event.startMinutes)}-${formatMinutes(event.endMinutes)}`}
                          >
                            <strong>{event.label}</strong>
                            <small>{formatMinutes(event.startMinutes)}-{formatMinutes(event.endMinutes)}</small>
                          </div>
                        );
                      })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        {unscheduledCourses.length > 0 ? (
          <p className={styles.unscheduledNotice}>
            시간 미정/온라인: {unscheduledCourses.map((course) => course.title).join(", ")}
          </p>
        ) : null}
        <div className={styles.saveImageRow}>
          <button disabled={isSavingImage} onClick={() => void handleSaveImage()} type="button">
            {isSavingImage ? "저장 중…" : "이미지로 저장"}
          </button>
          <button onClick={handleToggleShare} type="button">
            {isShareOpen ? "공유 링크 닫기" : "친구에게 공유"}
          </button>
          {saveImageError ? <span className={styles.saveImageError}>{saveImageError}</span> : null}
        </div>
        {isShareOpen && shareUrl ? (
          <div className={styles.sharePanel}>
            <p className={styles.sharePanelHint}>
              로그인 없이 이 링크(또는 QR)를 열면 이 시간표를 그대로 볼 수 있어요.
            </p>
            <div className={styles.shareLinkRow}>
              <input
                className={styles.shareLinkInput}
                onFocus={(event) => event.currentTarget.select()}
                readOnly
                type="text"
                value={shareUrl}
              />
              <button onClick={() => void handleCopyShareLink()} type="button">
                {shareCopied ? "복사됨" : "복사"}
              </button>
            </div>
            <div className={styles.shareQr}>
              <QRCodeSVG size={128} value={shareUrl} />
            </div>
          </div>
        ) : null}
        {footer}
      </details>
    </li>
  );
}

function describeTimetableVersion(extras: readonly TimetableExtra[]): string {
  if (extras.length === 0) {
    return "";
  }
  return [...new Set(extras.map((extra) => `${extra.groupTitle}: ${extra.title}`))].join(" · ");
}

export function formatCredits(credits: number): string {
  return Number.isInteger(credits) ? String(credits) : String(Number(credits.toFixed(1)));
}

export function formatMinutes(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "-").trim() || "timetable";
}
