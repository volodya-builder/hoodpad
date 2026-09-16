// Картинка из файла → квадратный data-URI под бюджет калдаты: обрезка в квадрат,
// ступенчатое уменьшение (без «лесенки»), подбор формата/качества. Общая для
// картинки монеты («Создать», 512px) и аватара профиля (256px).
export function fileToDataUrl(file, { size = 512, budget = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      // 1) crop to centered square
      const s = Math.min(img.width, img.height);
      let cur = document.createElement("canvas");
      cur.width = cur.height = s;
      let cx = cur.getContext("2d");
      cx.imageSmoothingQuality = "high";
      cx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, s, s);
      // 2) stepped downscale (halve until близко к цели) — без «лесенки»
      // (раньше условие цикла сравнивало переменную саму с собой и уменьшение
      // не работало — картинка уходила в цепь в исходном размере)
      let dim0 = s;
      while (dim0 / 2 >= size) {
        dim0 = Math.floor(dim0 / 2);
        const next = document.createElement("canvas");
        next.width = next.height = dim0;
        const nx = next.getContext("2d");
        nx.imageSmoothingQuality = "high";
        nx.drawImage(cur, 0, 0, dim0, dim0);
        cur = next;
      }
      const target = Math.min(dim0, size);
      // 3) финальный размер + подбор формата/качества под бюджет
      const attempts = [
        [target, "image/webp", 0.85],
        [target, "image/webp", 0.70],
        [target, "image/jpeg", 0.80], // Safari без WebP-энкодера вернёт png → пропустит
        [256, "image/webp", 0.75],
        [256, "image/jpeg", 0.75],
        [192, "image/jpeg", 0.75],
        [128, "image/jpeg", 0.75],
        [96, "image/jpeg", 0.70],
      ];
      let fallback = "";
      for (const [dim, mime, q] of attempts) {
        const c = document.createElement("canvas");
        c.width = c.height = dim;
        const dx = c.getContext("2d");
        dx.imageSmoothingQuality = "high";
        dx.drawImage(cur, 0, 0, dim, dim);
        const out = c.toDataURL(mime, q);
        if (!out.startsWith(`data:${mime}`)) continue; // формат не поддержан
        if (!fallback) fallback = out;
        if (out.length <= budget) return resolve(out);
      }
      resolve(fallback || cur.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = reject;
    img.src = url;
  });
}
