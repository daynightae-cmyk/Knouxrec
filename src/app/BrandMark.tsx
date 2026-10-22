

export default function BrandMark({
  size = 42,
  className = "kx-brand-mark",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src="./knoux-mark.svg"
      width={size}
      height={size}
      className={className}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
