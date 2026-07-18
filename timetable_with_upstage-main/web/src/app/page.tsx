import { PlanningWorkspace } from "@/components/PlanningWorkspace";
import { SyllabusUploader } from "@/components/SyllabusUploader";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>SKKU TIMETABLE</p>
        <h1>내 졸업 맥락을 읽고, 겹치지 않는 시간표를 찾습니다.</h1>
        <p>
          Upstage가 기수강 과목과 졸업요건을 초안으로 정리하고, 본인이 확정한 데이터만
          시간표 조합에 사용합니다.
        </p>
      </section>
      <PlanningWorkspace />
      <SyllabusUploader />
    </main>
  );
}
