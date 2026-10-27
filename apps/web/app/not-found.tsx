import Link from "next/link";
import { BoxArt } from "@/components/brand/illustrations";
import { SiteHeader } from "@/components/site-chrome";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto grid w-full max-w-xl flex-1 place-items-center px-4 py-24 text-center">
        <div className="grid justify-items-center">
          <BoxArt className="mb-6 size-24" />
          <h1 className="display text-[2.5rem] leading-tight">Nothing here</h1>
          <p className="text-soft mt-2 max-w-sm">That page, campaign or transaction doesn&apos;t exist on Rialo DevNet, or the link is incomplete.</p>
          <Button asChild className="mt-6">
            <Link href="/explore">Explore campaigns</Link>
          </Button>
        </div>
      </main>
    </>
  );
}
