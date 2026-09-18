// Константы ETH-кривой (LaunchpadFactoryV3). Отдельный файл без import.meta —
// его читают и сайт, и боты в обычном node (bot/arena через arena-core.js).
// 18.09.2026: виртуальный резерв 1.625 → 1 ETH (градация 6.5 → 4 ETH, у Pons 4.2),
// кап создателя 0.13 → 0.08 ETH. Порог = 4 × виртуальный резерв.
export const VIRTUAL_ETH = 1;
export const GRADUATION_ETH = 4;
export const CREATOR_CAP_ETH = 0.08;
