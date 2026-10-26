// Afbeeldingen klaarmaken voor de notenherkenning:
// doorzichtige achtergrond → wit, grijstinten, en kleine afbeeldingen vergroten.
import { Jimp, ResizeStrategy } from 'jimp';

export const IMAGE_EXT = /\.(png|jpe?g|bmp|tiff?|gif)$/i;

// Audiveris wil ~20 pixels tussen de notenbalklijnen; een A4 op 300 dpi is ~2480 px breed.
export async function prepareImage(input, output, { factor = null } = {}) {
  const img = await Jimp.read(input);
  const { width, height } = img.bitmap;
  let f = factor || (width < 2200 ? 2480 / width : 1);
  f = Math.min(f, 6);
  // op wit zetten (anders wordt doorzichtig vaak zwart)
  const bg = new Jimp({ width, height, color: 0xffffffff });
  bg.composite(img, 0, 0);
  bg.greyscale();
  if (f > 1.05) bg.resize({ w: Math.round(width * f), h: Math.round(height * f), mode: ResizeStrategy.BICUBIC });
  await bg.write(output);
  return { width, height, factor: f };
}
