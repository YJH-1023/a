import type { Metadata } from "next";
import Link from "next/link";

import { TimetableCard } from "@/components/TimetableCard";
import timetableStyles from "@/components/TimetablePlanner.module.css";
import { SITE_NAME } from "@/lib/site-config";
import { decodeShareableTimetable } from "@/lib/timetable-share";

import pageStyles from "../../page.module.css";
import styles from "./page.module.css";

interface SharePageProps {
  params: Promise<{ data: string }>;
}

export async function generateMetadata({ params }: SharePageProps): Promise<Metadata> {
  const { data } = await params;
  const timetable = decodeShareableTimetable(data);
  return {
    title: timetable ? "친구가 공유한 시간표" : "공유 링크를 열 수 없음",
  };
}

export default async function SharePage({ params }: SharePageProps) {
  const { data } = await params;
  const timetable = decodeShareableTimetable(data);

  if (!timetable) {
    return (
      <main className={pageStyles.page}>
        <section className={pageStyles.hero}>
          <p className={pageStyles.eyebrow}>SKKU TIMETABLE</p>
          <h1>링크를 열 수 없습니다</h1>
          <p>공유 링크가 손상되었거나 잘못된 주소입니다. 링크를 보낸 친구에게 다시 요청해 주세요.</p>
        </section>
        <Link className={styles.backLink} href="/">
          내 시간표 만들러 가기 → {SITE_NAME}
        </Link>
      </main>
    );
  }

  return (
    <main className={pageStyles.page}>
      <section className={pageStyles.hero}>
        <p className={pageStyles.eyebrow}>SKKU TIMETABLE</p>
        <h1>친구가 공유한 시간표</h1>
        <p>로그인 없이 열람만 가능한 화면입니다. 마음에 들면 나도 만들어 볼 수 있어요.</p>
      </section>
      <ol className={`${timetableStyles.timetableList} ${styles.cardList}`}>
        <TimetableCard extras={[]} heading="공유된 시간표" index={0} timetable={timetable} />
      </ol>
      <Link className={styles.backLink} href="/">
        나도 내 시간표 만들어보기 → {SITE_NAME}
      </Link>
    </main>
  );
}
