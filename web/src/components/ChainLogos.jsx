import React from "react";

/** Фирменные знаки сетей — инлайн-SVG в стиле официальных логотипов.
 *  Рисуем сами: сочные цвета, чёткость на любом экране, ноль запросов к CDN.
 *  size — диаметр круга в px. */
export default function ChainLogo({ chain, size = 26 }) {
  const s = { width: size, height: size, display: "block", flex: "none" };
  switch (chain) {
    case "sol":
      return (
        <svg style={s} viewBox="0 0 26 26" aria-hidden="true">
          <defs>
            <linearGradient id="solg" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#9945FF" />
              <stop offset="1" stopColor="#14F195" />
            </linearGradient>
          </defs>
          <circle cx="13" cy="13" r="13" fill="#0b0d12" />
          <g fill="url(#solg)">
            <path d="M8.6 7.4h9.2l-2 2.1H6.6l2-2.1z" />
            <path d="M6.6 12h9.2l2 2.1H8.6l-2-2.1z" />
            <path d="M8.6 16.5h9.2l-2 2.1H6.6l2-2.1z" />
          </g>
        </svg>
      );
    case "bsc":
      return (
        <svg style={s} viewBox="0 0 26 26" aria-hidden="true">
          <circle cx="13" cy="13" r="13" fill="#14151a" />
          <g fill="#F3BA2F">
            <path d="M13 5.6l2.5 2.5L13 10.6l-2.5-2.5L13 5.6z" />
            <path d="M7.9 10.7l2.5 2.3-2.5 2.3-2.3-2.3 2.3-2.3z" />
            <path d="M18.1 10.7l2.3 2.3-2.3 2.3-2.5-2.3 2.5-2.3z" />
            <path d="M13 10.8l2.2 2.2-2.2 2.2-2.2-2.2 2.2-2.2z" />
            <path d="M13 15.4l2.5 2.5L13 20.4l-2.5-2.5 2.5-2.5z" />
          </g>
        </svg>
      );
    case "base":
      return (
        <svg style={s} viewBox="0 0 26 26" aria-hidden="true">
          <circle cx="13" cy="13" r="13" fill="#0052FF" />
          <rect x="1" y="11.5" width="11.5" height="3" rx="1.5" fill="#fff" />
        </svg>
      );
    case "eth":
      return (
        <svg style={s} viewBox="0 0 26 26" aria-hidden="true">
          <circle cx="13" cy="13" r="13" fill="#627EEA" />
          <g fill="#fff">
            <path d="M13 4.5v6.28l5.3 2.37L13 4.5z" fillOpacity=".6" />
            <path d="M13 4.5L7.7 13.15l5.3-2.37V4.5z" />
            <path d="M13 17.1v4.4l5.3-7.35L13 17.1z" fillOpacity=".6" />
            <path d="M13 21.5v-4.4l-5.3-2.95L13 21.5z" />
            <path d="M13 16.1l5.3-3-5.3-2.36v5.36z" fillOpacity=".25" />
            <path d="M7.7 13.1l5.3 3v-5.36l-5.3 2.36z" fillOpacity=".6" />
          </g>
        </svg>
      );
    case "robinhood":
    default:
      return (
        <svg style={s} viewBox="0 0 26 26" aria-hidden="true">
          <circle cx="13" cy="13" r="13" fill="#CDF32E" />
          {/* перо: изогнутый лист со стержнем */}
          <path d="M18.6 6.2c-4.6.5-7.9 2.5-9.4 5.6-.9 1.8-1 3.9-.5 5.6.2-2.4 1.2-4.5 3-6.1-1 1.7-1.6 3.6-1.5 5.7.1 1.3.5 2.4 1 3.1.4-.1.9-.3 1.4-.6-.3-1.2-.3-2.7.2-4.2.7 1 1.7 1.6 2.9 1.7-1.6-1.5-2.2-3.1-1.9-4.9 2.6-.4 4.3-2.4 4.8-5.9z"
                fill="#101208" />
        </svg>
      );
  }
}
