"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Application error", error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-navy-50 p-6">
      <section className="w-full max-w-lg rounded-md border border-navy-100 bg-white p-6 shadow-sm">
        <p className="text-sm font-bold text-rose-600">오류가 발생했습니다</p>
        <h1 className="mt-2 text-2xl font-black text-navy-900">작업을 다시 시도해 주세요</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">입력 중이던 데이터가 있다면 먼저 JSON 백업 파일을 확인해 주세요. 같은 문제가 반복되면 브라우저 콘솔 오류 내용을 확인하면 원인 파악에 도움이 됩니다.</p>
        {error.digest && <p className="mt-3 rounded-md bg-navy-50 p-3 text-xs text-slate-500">오류 ID: {error.digest}</p>}
        <div className="mt-5 flex justify-end">
          <Button onClick={reset}>다시 시도</Button>
        </div>
      </section>
    </main>
  );
}
