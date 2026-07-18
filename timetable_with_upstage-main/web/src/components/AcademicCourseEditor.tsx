import { useState } from "react";

import type { AcademicProfile, CompletedCourse } from "@/lib/academic-profile";

import styles from "./AcademicDocumentManager.module.css";

interface Props {
  profile: AcademicProfile;
  onChange: (profile: AcademicProfile) => void;
}

export function AcademicCourseEditor({ profile, onChange }: Props) {
  const [explicitOpenIndexes, setExplicitOpenIndexes] = useState<Set<number> | null>(null);

  function getOpenIndexes(): Set<number> {
    if (explicitOpenIndexes) {
      return new Set(explicitOpenIndexes);
    }
    return new Set(profile.completedCourses.map((_, index) => index));
  }

  function isCourseOpen(index: number): boolean {
    return explicitOpenIndexes ? explicitOpenIndexes.has(index) : true;
  }

  function toggleCourseOpen(index: number): void {
    const nextOpenIndexes = getOpenIndexes();
    if (nextOpenIndexes.has(index)) {
      nextOpenIndexes.delete(index);
    } else {
      nextOpenIndexes.add(index);
    }
    setExplicitOpenIndexes(nextOpenIndexes);
  }

  function setAllCoursesOpen(open: boolean): void {
    setExplicitOpenIndexes(
      new Set(open ? profile.completedCourses.map((_, index) => index) : []),
    );
  }

  function updateCourse(index: number, course: CompletedCourse): void {
    onChange({
      ...profile,
      completedCourses: profile.completedCourses.map((current, currentIndex) =>
        currentIndex === index ? course : current,
      ),
    });
  }

  function addCourse(): void {
    const sourceDocumentId = profile.sourceDocuments[0]?.id;
    if (!sourceDocumentId) {
      return;
    }
    onChange({
      ...profile,
      completedCourses: [
        ...profile.completedCourses,
        {
          courseCode: "",
          courseName: "",
          majorScope: "",
          classification: "",
          year: null,
          term: null,
          credits: 0,
          area: "",
          completionStatus: "earned",
          recommendationPolicy: "exclude",
          flags: [],
          sourceDocumentId,
          reviewReasons: [],
        },
      ],
    });
  }

  function deleteCourse(index: number): void {
    onChange({
      ...profile,
      completedCourses: profile.completedCourses.filter((_, currentIndex) => currentIndex !== index),
    });
  }

  return (
    <div className={styles.dataSection}>
      <div className={styles.sectionHeading}>
        <div>
          <p>기수강 과목</p>
          <h3>{profile.completedCourses.length}개</h3>
        </div>
        <div className={styles.sectionControls}>
          <button type="button" onClick={() => setAllCoursesOpen(false)}>
            전체 접기
          </button>
          <button type="button" onClick={() => setAllCoursesOpen(true)}>
            전체 펼치기
          </button>
          <button className={styles.secondaryButton} type="button" onClick={addCourse}>
            + 과목 수동 추가
          </button>
        </div>
      </div>

      {profile.completedCourses.length === 0 ? (
        <p className={styles.dataEmpty}>추출된 과목이 없습니다. 필요하면 수동으로 추가해 주세요.</p>
      ) : (
        <ol className={styles.cardList}>
          {profile.completedCourses.map((course, index) => {
            const isOpen = isCourseOpen(index);
            const panelId = `course-panel-${index + 1}`;
            return (
            <li
              className={`${styles.dataCard} ${styles.requirementCard} ${isOpen ? "" : styles.collapsedCard}`}
              key={`${course.sourceDocumentId}-${index}`}
            >
              <div className={styles.cardTopline}>
                <div className={styles.cardIdentity}>
                  <strong>과목 {index + 1}</strong>
                  <span>{course.courseName || "과목명 미입력"}</span>
                </div>
                <div className={styles.cardActions}>
                  {course.reviewReasons.length > 0 ? <span>확인 필요 {course.reviewReasons.length}</span> : null}
                  <button
                    aria-controls={panelId}
                    aria-expanded={isOpen}
                    className={styles.cardToggleButton}
                    type="button"
                    onClick={() => toggleCourseOpen(index)}
                  >
                    {isOpen ? "접기" : "펼치기"}
                  </button>
                  <button className={styles.deleteButton} type="button" onClick={() => deleteCourse(index)}>
                    삭제
                  </button>
                </div>
              </div>

              {!isOpen ? (
                <p className={styles.collapsedSummary}>
                  <span>{course.courseCode || "학수번호 미입력"}</span>
                  <span>{course.classification || "이수구분 미상"}</span>
                  <span>{course.credits}학점</span>
                  <span>{course.recommendationPolicy === "retake" ? "재수강 예정" : "재수강 안 함"}</span>
                </p>
              ) : null}

              {isOpen ? (
              <div className={styles.cardBody} id={panelId}>
              <div className={`${styles.fieldGrid} ${styles.courseFieldGrid}`}>
                <label className={styles.field}>
                  <span>학수번호</span>
                  <input
                    maxLength={10}
                    value={course.courseCode}
                    onChange={(event) =>
                      updateCourse(index, { ...course, courseCode: event.target.value.toUpperCase() })
                    }
                  />
                </label>
                <label className={`${styles.field} ${styles.wideField}`}>
                  <span>과목명</span>
                  <input
                    value={course.courseName}
                    onChange={(event) => updateCourse(index, { ...course, courseName: event.target.value })}
                  />
                </label>
                <label className={styles.field}>
                  <span>학점</span>
                  <input
                    min="0"
                    step="0.5"
                    type="number"
                    value={numberInputValue(course.credits)}
                    onChange={(event) =>
                      updateCourse(index, { ...course, credits: event.target.valueAsNumber })
                    }
                  />
                </label>
                <label className={styles.field}>
                  <span>이수년도</span>
                  <input
                    min="2000"
                    max="2100"
                    type="number"
                    value={course.year ?? ""}
                    onChange={(event) =>
                      updateCourse(index, {
                        ...course,
                        year: event.target.value ? event.target.valueAsNumber : null,
                      })
                    }
                  />
                </label>
                <label className={styles.field}>
                  <span>학기</span>
                  <select
                    value={course.term ?? ""}
                    onChange={(event) =>
                      updateCourse(index, {
                        ...course,
                        term: event.target.value
                          ? (event.target.value as CompletedCourse["term"])
                          : null,
                      })
                    }
                  >
                    <option value="">확인 필요</option>
                    <option value="spring">1학기</option>
                    <option value="summer">여름학기</option>
                    <option value="fall">2학기</option>
                    <option value="winter">겨울학기</option>
                  </select>
                </label>
                <label className={styles.field}>
                  <span>전공 범위</span>
                  <input
                    value={course.majorScope}
                    onChange={(event) => updateCourse(index, { ...course, majorScope: event.target.value })}
                  />
                </label>
                <label className={styles.field}>
                  <span>이수구분</span>
                  <input
                    value={course.classification}
                    onChange={(event) =>
                      updateCourse(index, { ...course, classification: event.target.value })
                    }
                  />
                </label>
                <label className={styles.field}>
                  <span>영역</span>
                  <input
                    value={course.area}
                    onChange={(event) => updateCourse(index, { ...course, area: event.target.value })}
                  />
                </label>
                <label className={styles.field}>
                  <span>이수 상태</span>
                  <select
                    value={course.completionStatus}
                    onChange={(event) =>
                      updateCourse(index, {
                        ...course,
                        completionStatus: event.target.value as CompletedCourse["completionStatus"],
                      })
                    }
                  >
                    <option value="earned">이수</option>
                    <option value="failed">미이수</option>
                    <option value="withdrawn">철회</option>
                    <option value="review">확인 필요</option>
                  </select>
                </label>
              </div>
              <label className={styles.retakeToggle}>
                <input
                  checked={course.recommendationPolicy === "retake"}
                  type="checkbox"
                  onChange={(event) =>
                    updateCourse(index, {
                      ...course,
                      recommendationPolicy: event.target.checked ? "retake" : "exclude",
                    })
                  }
                />
                <span>이 과목을 재수강할 예정이므로 추천 후보에 포함</span>
              </label>
              </div>
              ) : null}
            </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function numberInputValue(value: number): number | "" {
  return Number.isFinite(value) ? value : "";
}
