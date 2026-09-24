import Image from "next/image";
import Link from "next/link";
import yanvahMark from "../../../assets/mark-white.svg";

export function Brand(): React.JSX.Element {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-2.5 rounded-sm"
      aria-label="Yanvah Control"
    >
      <Image
        src={yanvahMark}
        alt=""
        width={28}
        height={27}
        priority
        className="h-[27px] w-auto"
      />
      <span className="text-[17px] font-semibold tracking-[-0.025em] text-foreground">
        Control
      </span>
    </Link>
  );
}
