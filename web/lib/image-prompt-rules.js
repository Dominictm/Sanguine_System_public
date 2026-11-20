'use strict';

// Shared instructions for portrait and location prompts. Keep the generation
// contracts endpoint-specific; this module contains only reusable visual rules.
const PORTRAIT_NEGATIVE_PROMPT = 'photorealistic photo, hyperrealistic photograph, anime, cartoon, flat illustration, plastic skin, 3D render, CGI, watermark, text overlay, blurry, low quality, artifacts, deformed anatomy, extra limbs, oversaturated colors, bright white background, cracked skin, marble skin, stone texture skin, nebula background, galaxy background, cosmic energy background, swirling portal background';
const LOCATION_NEGATIVE_PROMPT = 'daytime, sunlight, crowds of people, faces in foreground, modern post-2010 elements, anime, cartoon, flat lighting, low quality, blurry, text overlay, watermark, oversaturated colors, 3D plastic render, deformed';

const LOCATION_IMAGE_RULES = `# LOCATION IMAGE PROMPT RULES
Write the image prompt entirely in English. Build a coherent gothic-noir image from the location description and confirmed city context; do not add unsupported historical claims.
- The positive prompt has exactly three labeled blocks: Place, Light and Atmosphere, Style.
- Use a deliberate palette: primary hue, supporting secondary hue, and one restrained accent.
- State a plausible time of night and its lighting effect when the description supports one. Do not turn dusk into daylight.
- Set a clear mood and let it guide light, color, and composition.
- Match architectural detail and period to the supplied location and city facts. If the era is unknown, describe visible architecture without assigning a period.
- Specify lens and depth of field only when they improve the requested composition; keep film grain subtle or omit it.
- Prioritize atmosphere, architecture, or details according to the location's purpose.
- Include the standard location negative prompt: ${LOCATION_NEGATIVE_PROMPT}.
- Do not add blood, gore, wounds, or violence to the image prompt.
- Put image-prompt instructions and output in English; the location card itself remains in Russian.`;

const CHARACTER_IMAGE_RULES = `# CHARACTER IMAGE PROMPT RULES
- Match clothing and styling to the character's documented era and role. If dates are missing, use the documented setting and appearance without inventing a precise historical period.
- Let documented motives and personality shape expression and body language; do not invent motives when the card has none.
- Preserve the three-block portrait format and the established painterly style.
- Keep Block 2 an abstract color-wash background, never a location. A known key location may influence only its dominant hue, not add buildings, interiors, landscapes, or recognizable places.
- Keep clan accent restricted to rim light/background tint; never alter skin, eyes, or hair to match it.
- Exclude blood, gore, wounds, injuries, and violence from the positive prompt.
- Shared negative prompt: ${PORTRAIT_NEGATIVE_PROMPT}.`;

module.exports = { PORTRAIT_NEGATIVE_PROMPT, LOCATION_NEGATIVE_PROMPT, LOCATION_IMAGE_RULES, CHARACTER_IMAGE_RULES };
