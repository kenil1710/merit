"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { GoLive, type GoLiveProgram } from "@/components/app/go-live";
import { Button } from "@/components/ui/button";

export function SetupFlow({ program }: { program: GoLiveProgram }) {
  const router = useRouter();
  const [live, setLive] = useState(false);
  return (
    <div className="grid gap-6">
      <GoLive
        program={program}
        onLive={() => {
          setLive(true);
          router.refresh();
        }}
      />
      {live ? (
        <Button asChild size="lg" className="h-11 w-fit px-5 text-[15px]">
          <Link href={`/app/programs/${program.id}`}>
            Go to the program
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
