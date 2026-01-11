import React from "react";

type Props = {
  className?: string;
};

export function SpinnerIcon({ className }: Props) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle
        className="spinner"
        cx="12"
        cy="12"
        r="10"
        fill="none"
        strokeWidth="1.35"
        stroke="currentColor"
        strokeDasharray="32"
        strokeLinecap="round"
      />
    </svg>
  );
}

