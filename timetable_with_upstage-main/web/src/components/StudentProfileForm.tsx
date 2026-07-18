"use client";

import {
  type FocusEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { trackFieldComplete, trackFieldFocus } from "@/lib/analytics";
import {
  getCourseQueryLabel,
  getStudentProfileError,
  type StudentPlanningProfile,
} from "@/lib/planning-profile";
import {
  filterSkkuDepartments,
  findSkkuDepartment,
  groupSkkuDepartments,
  SKKU_DEPARTMENTS,
  type SkkuDepartment,
} from "@/lib/skku-departments";
import type { SkkuTerm } from "@/lib/skku-course-api";
import {
  ADMISSION_YEAR_OPTIONS,
  COURSE_YEAR_OPTIONS,
  parseDirectYear,
  type YearOption,
} from "@/lib/student-profile-options";

import styles from "./StudentProfileForm.module.css";

interface Props {
  profile: StudentPlanningProfile;
  appliedProfile: StudentPlanningProfile | null;
  onChange: (profile: StudentPlanningProfile) => void;
  onApply: (profile: StudentPlanningProfile) => void;
}

const TERMS: ReadonlyArray<{ value: SkkuTerm; label: string }> = [
  { value: 10, label: "1학기" },
  { value: 15, label: "여름학기" },
  { value: 20, label: "2학기" },
  { value: 25, label: "겨울학기" },
];
const GRADE_OPTIONS: ReadonlyArray<ProfileSelectOption> = [
  { value: "", label: "학년 선택" },
  ...[1, 2, 3, 4, 5, 6].map((grade) => ({ value: String(grade), label: `${grade}학년` })),
  { value: "7", label: "초과학기" },
];
const CAMPUS_OPTIONS: ReadonlyArray<ProfileSelectOption> = [
  { value: "", label: "캠퍼스 선택" },
  { value: "humanities", label: "인문사회과학캠퍼스" },
  { value: "natural_sciences", label: "자연과학캠퍼스" },
];

export function StudentProfileForm({ profile, appliedProfile, onChange, onApply }: Props) {
  const departmentInputRef = useRef<HTMLInputElement>(null);
  const [departmentSearch, setDepartmentSearch] = useState(
    () => findSkkuDepartment(profile.departmentCode)?.name ?? "",
  );
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [isDepartmentListOpen, setIsDepartmentListOpen] = useState(false);
  const [activeDepartmentCode, setActiveDepartmentCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const visibleDepartments = useMemo(
    () => filterSkkuDepartments(departmentFilter),
    [departmentFilter],
  );
  const departmentGroups = useMemo(
    () => groupSkkuDepartments(visibleDepartments),
    [visibleDepartments],
  );
  const selectedDepartment = findSkkuDepartment(profile.departmentCode);

  function applyProfile(): void {
    const nextError = getStudentProfileError(profile);
    if (nextError) {
      setError(nextError);
      return;
    }
    setError("");
    onApply(profile);
  }

  function changeDepartment(value: string): void {
    setDepartmentSearch(value);
    setDepartmentFilter(value);
    setActiveDepartmentCode(null);
    const normalized = value.trim();
    const selected = SKKU_DEPARTMENTS.find(
      (department) =>
        department.code === normalized ||
        department.name === normalized,
    );
    onChange({
      ...profile,
      departmentCode: selected?.code ?? (/^\d{4,8}$/.test(normalized) ? normalized : ""),
    });
  }

  function selectDepartment(department: SkkuDepartment): void {
    setDepartmentSearch(department.name);
    setDepartmentFilter("");
    setActiveDepartmentCode(department.code);
    setIsDepartmentListOpen(false);
    onChange({ ...profile, departmentCode: department.code });
    trackFieldComplete("department", department.code);
  }

  function moveActiveDepartment(direction: 1 | -1): void {
    if (visibleDepartments.length === 0) {
      return;
    }

    const currentIndex = visibleDepartments.findIndex(
      (department) => department.code === activeDepartmentCode,
    );
    const nextIndex = currentIndex < 0
      ? direction === 1 ? 0 : visibleDepartments.length - 1
      : (currentIndex + direction + visibleDepartments.length) % visibleDepartments.length;
    const nextDepartment = visibleDepartments[nextIndex];
    setActiveDepartmentCode(nextDepartment.code);

    requestAnimationFrame(() => {
      document.getElementById(`department-option-${nextDepartment.code}`)?.scrollIntoView({
        block: "nearest",
      });
    });
  }

  function handleDepartmentKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setIsDepartmentListOpen(true);
      moveActiveDepartment(event.key === "ArrowDown" ? 1 : -1);
      return;
    }

    if (event.key === "Enter" && isDepartmentListOpen && activeDepartmentCode) {
      const activeDepartment = visibleDepartments.find(
        (department) => department.code === activeDepartmentCode,
      );
      if (activeDepartment) {
        event.preventDefault();
        selectDepartment(activeDepartment);
      }
      return;
    }

    if (event.key === "Escape") {
      setIsDepartmentListOpen(false);
      setActiveDepartmentCode(null);
    }
  }

  function handleDepartmentBlur(event: FocusEvent<HTMLDivElement>): void {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setIsDepartmentListOpen(false);
      setActiveDepartmentCode(null);
      trackFieldComplete("department", profile.departmentCode);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="student-profile-heading">
      <div className={styles.heading}>
        <div>
          <p>STEP 1 · 기본 정보</p>
          <h2 id="student-profile-heading">어떤 강좌를 찾을지 먼저 알려 주세요.</h2>
        </div>
        {appliedProfile ? (
          <span className={styles.appliedBadge}>{getCourseQueryLabel(appliedProfile)} 적용됨</span>
        ) : null}
      </div>

      <div className={styles.grid}>
        <div className={`${styles.field} ${styles.departmentField}`}>
          <label className={styles.fieldLabel} htmlFor="student-department-search">
            소속 학과·전공·트랙
          </label>
          <div className={styles.departmentPicker} onBlur={handleDepartmentBlur}>
            <div className={styles.departmentControl}>
              <input
                ref={departmentInputRef}
                id="student-department-search"
                aria-activedescendant={
                  activeDepartmentCode ? `department-option-${activeDepartmentCode}` : undefined
                }
                aria-autocomplete="list"
                aria-controls="skku-department-options"
                aria-expanded={isDepartmentListOpen}
                autoComplete="off"
                placeholder="학과명·전공명·트랙명 또는 6자리 코드 검색"
                role="combobox"
                type="search"
                value={departmentSearch}
                onChange={(event) => {
                  changeDepartment(event.target.value);
                  setIsDepartmentListOpen(true);
                }}
                onFocus={() => {
                  trackFieldFocus("department");
                  if (selectedDepartment) {
                    setDepartmentFilter("");
                  }
                  setIsDepartmentListOpen(true);
                }}
                onKeyDown={handleDepartmentKeyDown}
              />
              <button
                aria-label={isDepartmentListOpen ? "소속 목록 닫기" : "소속 목록 열기"}
                className={styles.departmentToggle}
                type="button"
                onClick={() => {
                  const nextOpen = !isDepartmentListOpen;
                  if (nextOpen) {
                    setDepartmentFilter("");
                  }
                  setIsDepartmentListOpen(nextOpen);
                  departmentInputRef.current?.focus();
                }}
                onMouseDown={(event) => event.preventDefault()}
              >
                <span aria-hidden="true">⌄</span>
              </button>
            </div>

            {isDepartmentListOpen ? (
              <div
                id="skku-department-options"
                aria-label="대학·학부별 소속 목록"
                className={styles.departmentDropdown}
                role="listbox"
              >
                {departmentGroups.length > 0 ? departmentGroups.map((group) => {
                  const groupId = `department-group-${group.departments[0].code}`;
                  return (
                    <div
                      key={group.college}
                      aria-labelledby={groupId}
                      className={styles.departmentGroup}
                      role="group"
                    >
                      <div id={groupId} className={styles.departmentGroupLabel}>
                        {group.college}
                      </div>
                      {group.departments.map((department) => {
                        const isActive = department.code === activeDepartmentCode;
                        const isSelected = department.code === profile.departmentCode;
                        return (
                          <button
                            key={department.code}
                            id={`department-option-${department.code}`}
                            aria-selected={isSelected}
                            className={[
                              styles.departmentOption,
                              isActive ? styles.departmentOptionActive : "",
                              isSelected ? styles.departmentOptionSelected : "",
                            ].filter(Boolean).join(" ")}
                            role="option"
                            tabIndex={-1}
                            type="button"
                            onClick={() => selectDepartment(department)}
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseEnter={() => setActiveDepartmentCode(department.code)}
                          >
                            <span>{department.name}</span>
                            <small>{department.code}</small>
                          </button>
                        );
                      })}
                    </div>
                  );
                }) : (
                  <p className={styles.departmentEmpty}>일치하는 소속이 없습니다.</p>
                )}
              </div>
            ) : null}
          </div>
          <small className={styles.departmentHint}>
            {selectedDepartment
              ? `${selectedDepartment.college} · ${selectedDepartment.name} · ${selectedDepartment.code}`
              : profile.departmentCode
                ? `입력 코드 ${profile.departmentCode}`
              : "검색 결과에서 소속을 선택하세요. 목록에 없으면 6자리 코드를 입력할 수 있습니다."}
          </small>
        </div>

        <YearCombobox
          id="student-admission-year"
          label="입학연도"
          max={profile.courseYear}
          min={2000}
          options={ADMISSION_YEAR_OPTIONS.filter(({ value }) => value <= profile.courseYear)}
          placeholder="연도 입력"
          value={profile.admissionYear}
          onChange={(admissionYear) => onChange({ ...profile, admissionYear })}
        >
          <small className={styles.admissionYearHint}>
            2018~2026년은 목록에서 고르거나 다른 연도를 바로 입력하세요.
          </small>
        </YearCombobox>

        <ProfileSelect
          id="student-current-grade"
          label="현재 학년"
          options={GRADE_OPTIONS}
          value={profile.currentGrade === null ? "" : String(profile.currentGrade)}
          onChange={(value) =>
            onChange({ ...profile, currentGrade: value ? Number(value) : null })
          }
        />

        <ProfileSelect
          id="student-primary-campus"
          label="주 캠퍼스"
          options={CAMPUS_OPTIONS}
          value={profile.primaryCampus ?? ""}
          onChange={(value) =>
            onChange({
              ...profile,
              primaryCampus: value
                ? (value as StudentPlanningProfile["primaryCampus"])
                : null,
            })
          }
        />

        <YearCombobox
          id="student-course-year"
          label="조회 학년도"
          max={2100}
          min={2020}
          options={COURSE_YEAR_OPTIONS}
          placeholder="학년도 입력"
          value={profile.courseYear}
          onChange={(courseYear) => onChange({ ...profile, courseYear: courseYear ?? 2026 })}
        />

        <ProfileSelect
          id="student-course-term"
          label="조회 학기"
          options={TERMS.map(({ value, label }) => ({ value: String(value), label }))}
          value={String(profile.courseTerm)}
          onChange={(value) =>
            onChange({ ...profile, courseTerm: Number(value) as SkkuTerm })
          }
        />
      </div>

      <div className={styles.actions}>
        <p>이름과 전체 학번은 받지 않습니다. 선택한 학과 범위만 성대 공개 API에서 조회합니다.</p>
        <button type="button" onClick={applyProfile}>이 조건으로 전공·교양 개설강좌 조회</button>
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </section>
  );
}

interface ProfileSelectOption {
  value: string;
  label: string;
}

interface ProfileSelectProps {
  id: string;
  label: string;
  value: string;
  options: ReadonlyArray<ProfileSelectOption>;
  onChange: (value: string) => void;
}

function ProfileSelect({ id, label, value, options, onChange }: ProfileSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = options[selectedIndex];

  useEffect(() => {
    if (isOpen && activeIndex >= 0) {
      document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, id, isOpen]);

  function openList(): void {
    if (!isOpen) {
      trackFieldFocus(id);
    }
    setIsOpen(true);
    setActiveIndex(options.length === 0 ? -1 : selectedIndex >= 0 ? selectedIndex : 0);
  }

  function closeList(): void {
    setIsOpen(false);
    setActiveIndex(-1);
  }

  function moveActiveOption(direction: 1 | -1): void {
    if (options.length === 0) {
      return;
    }
    setIsOpen(true);
    setActiveIndex((current) => {
      const start = current >= 0 ? current : selectedIndex >= 0 ? selectedIndex : 0;
      return (start + direction + options.length) % options.length;
    });
  }

  function selectOption(option: ProfileSelectOption): void {
    onChange(option.value);
    trackFieldComplete(id, option.value);
    closeList();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActiveOption(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && isOpen && activeIndex >= 0) {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) {
        selectOption(option);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeList();
    }
  }

  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} id={`${id}-label`} htmlFor={id}>{label}</label>
      <div
        className={styles.profilePicker}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            closeList();
          }
        }}
      >
        <button
          id={id}
          aria-activedescendant={
            isOpen && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined
          }
          aria-controls={`${id}-options`}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          className={styles.profileSelectControl}
          type="button"
          onClick={() => isOpen ? closeList() : openList()}
          onKeyDown={handleKeyDown}
        >
          <span className={value ? styles.profileSelectValue : styles.profileSelectPlaceholder}>
            {selectedOption?.label ?? "선택"}
          </span>
          <span aria-hidden="true" className={styles.profileSelectArrow}>⌄</span>
        </button>
        {isOpen ? (
          <div
            id={`${id}-options`}
            aria-labelledby={`${id}-label`}
            className={styles.profileDropdown}
            role="listbox"
          >
            {options.map((option, index) => (
              <button
                key={option.value || "empty"}
                id={`${id}-option-${index}`}
                aria-selected={option.value === value}
                className={[
                  styles.profileOption,
                  index === activeIndex ? styles.profileOptionActive : "",
                  option.value === value ? styles.profileOptionSelected : "",
                ].filter(Boolean).join(" ")}
                role="option"
                tabIndex={-1}
                type="button"
                onClick={() => selectOption(option)}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface YearComboboxProps {
  id: string;
  label: string;
  value: number | null;
  min: number;
  max: number;
  placeholder: string;
  options: ReadonlyArray<YearOption>;
  children?: React.ReactNode;
  onChange: (value: number | null) => void;
}

function YearCombobox({
  id,
  label,
  value,
  min,
  max,
  placeholder,
  options,
  children,
  onChange,
}: YearComboboxProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const selectedIndex = options.findIndex((option) => option.value === value);

  useEffect(() => {
    if (isOpen && activeIndex >= 0) {
      document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, id, isOpen]);

  function openList(): void {
    if (!isOpen) {
      trackFieldFocus(id);
    }
    setIsOpen(true);
    setActiveIndex(options.length === 0 ? -1 : selectedIndex >= 0 ? selectedIndex : 0);
  }

  function closeList(): void {
    setIsOpen(false);
    setActiveIndex(-1);
    trackFieldComplete(id, value === null ? "" : String(value));
  }

  function moveActiveOption(direction: 1 | -1): void {
    if (options.length === 0) {
      return;
    }
    setIsOpen(true);
    setActiveIndex((current) => {
      const start = current >= 0 ? current : selectedIndex >= 0 ? selectedIndex : 0;
      return (start + direction + options.length) % options.length;
    });
  }

  function selectOption(option: YearOption): void {
    onChange(option.value);
    closeList();
    inputRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActiveOption(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter" && isOpen && activeIndex >= 0) {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) {
        selectOption(option);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeList();
    }
  }

  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={id}>{label}</label>
      <div
        className={styles.profilePicker}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            closeList();
          }
        }}
      >
        <div className={styles.yearControl}>
          <input
            ref={inputRef}
            id={id}
            aria-activedescendant={
              isOpen && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined
            }
            aria-autocomplete="list"
            aria-controls={`${id}-options`}
            aria-describedby={`${id}-range`}
            aria-expanded={isOpen}
            autoComplete="off"
            inputMode="numeric"
            maxLength={4}
            placeholder={placeholder}
            role="combobox"
            type="text"
            value={value ?? ""}
            onChange={(event) => {
              onChange(parseDirectYear(event.target.value));
              setActiveIndex(-1);
              setIsOpen(true);
            }}
            onFocus={openList}
            onKeyDown={handleKeyDown}
          />
          {value !== null ? <span aria-hidden="true" className={styles.yearUnit}>년</span> : null}
          <button
            aria-label={isOpen ? `${label} 목록 닫기` : `${label} 목록 열기`}
            className={styles.profileToggle}
            tabIndex={-1}
            type="button"
            onClick={() => {
              inputRef.current?.focus();
              if (isOpen) {
                closeList();
              } else {
                openList();
              }
            }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <span aria-hidden="true">⌄</span>
          </button>
        </div>
        {isOpen ? (
          <div
            id={`${id}-options`}
            aria-label={`${label} 빠른 선택`}
            className={styles.profileDropdown}
            role="listbox"
          >
            {options.map((option, index) => (
              <button
                key={option.value}
                id={`${id}-option-${index}`}
                aria-selected={option.value === value}
                className={[
                  styles.profileOption,
                  index === activeIndex ? styles.profileOptionActive : "",
                  option.value === value ? styles.profileOptionSelected : "",
                ].filter(Boolean).join(" ")}
                role="option"
                tabIndex={-1}
                type="button"
                onClick={() => selectOption(option)}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {children}
      <span id={`${id}-range`} className={styles.srOnly}>
        {min}년부터 {max}년까지 입력 가능
      </span>
    </div>
  );
}
