import { describe, expect, it } from "vitest";

import {
  filterSkkuDepartments,
  groupSkkuDepartments,
  type SkkuDepartment,
} from "./skku-departments";

const DEPARTMENTS: readonly SkkuDepartment[] = [
  { code: "316307", name: "건축학과", college: "공과대학" },
  { code: "316308", name: "건축공학과", college: "공과대학" },
  { code: "316901", name: "경영학과", college: "경영대학" },
];

describe("SKKU department choices", () => {
  it("groups departments under one college heading in source order", () => {
    expect(groupSkkuDepartments(DEPARTMENTS)).toEqual([
      {
        college: "공과대학",
        departments: [DEPARTMENTS[0], DEPARTMENTS[1]],
      },
      {
        college: "경영대학",
        departments: [DEPARTMENTS[2]],
      },
    ]);
  });

  it("searches by college, department name, and six-digit code", () => {
    expect(filterSkkuDepartments("공과대학", DEPARTMENTS)).toEqual([
      DEPARTMENTS[0],
      DEPARTMENTS[1],
    ]);
    expect(filterSkkuDepartments("건축학과", DEPARTMENTS)).toEqual([DEPARTMENTS[0]]);
    expect(filterSkkuDepartments("316901", DEPARTMENTS)).toEqual([DEPARTMENTS[2]]);
  });
});
