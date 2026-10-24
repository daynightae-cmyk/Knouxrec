# KNOUX REC capability registry

Generated 2026-10-23T23:02:29.026Z from commit 05a542957a62730301972361c1300ccd7d66ca54 (working tree).

Counts: routes=16, core=16, offlineAI=38, arabicAI=38, visualPatch=50, morphCore=50, toolbox=8, templatesBase=5, templatesGenerated=51, models=24.

Statuses are evidence-based. `MISSING_MODEL` and `MISSING_ENGINE` mean the catalog entry ships without its runtime; `MOCK` means the data is explicitly generated placeholder content; `BLOCKED` means the view cannot be mounted as shipped.

## Routes

| Route | Group | State | Summary |
| --- | --- | --- | --- |
| dashboard | capture | VERIFIED | Unified capture dashboard with live recorder status and recent local media. |
| studio | capture | VERIFIED | Real getDisplayMedia/getUserMedia capture through MediaRecorder with pause/resume and persisted output. |
| screenshots | capture | VERIFIED | Real pixel capture from the display stream with PNG/JPEG/WebP encoding. |
| library | library | VERIFIED | Persistent local library with preview, rename, delete, export and trim. |
| templates | create | VERIFIED | Five templates render real canvas frames at any playhead and export real WebM video (canvas.captureStream + MediaRecorder); the 51 generated entries stay labelled as mock because they carry no template content. |
| toolbox | create | VERIFIED | Eight local media utilities with real processors: resize, filters, format conversion (PNG/JPEG/WebP), video thumbnail, waveform, text image, QR code and colour palette. |
| visual-patch | create | PARTIAL | Region based image editor with the fifty preserved tools and their real canvas processors: paint a region, apply the tool, compare, undo and export. |
| morphcore | create | MISSING_ENGINE | Body-shape tool catalog preserved, but it depended on fictional .exe modules and fabricated output paths. |
| elysian | create | PARTIAL | Image editing workspace with slider filters, real presets, before/after comparison, verified PNG export and library save. The AI inference pipeline is not part of the bundle. |
| body-editor | create | MISSING_MODEL | Age-gated body editor UI preserved. It depends on segmentation models whose weight files are not distributed. |
| offline-ai | intelligence | PARTIAL | One unified catalog of 38 on-device tasks. 15 run now on deterministic local engines (DSP, canvas, container analysis); the other 23 stay blocked until their weight binaries exist. |
| arabic-ai | intelligence | PARTIAL | The Arabic entry point of the same 38 canonical tasks, with Arabic titles, descriptions and features taken from the preserved panel. The 15 deterministic tasks run here too. |
| models | intelligence | MISSING_MODEL | Model manifest inventory with explicit weight-file verification. |
| settings | system | VERIFIED | Persisted appearance, language and recording defaults. |
| diagnostics | system | VERIFIED | Runtime capability matrix measured from MediaDevices, MediaRecorder, IndexedDB, the Electron bridge and the bundled model folders. |
| live-studio | create | VERIFIED | Shared execution workspace for every real job: media tools, template WebM exports and recordings, with live lifecycle events, media previews, verification and save/export. |

## Core runtime

| Capability | State | Evidence |
| --- | --- | --- |
| screen-recording | RUNTIME_VERIFIED | Headless Chrome fake display: 1920x1080 VP9/Opus WebM, patched finite duration, exported EBML signature. |
| camera-recording | RUNTIME_VERIFIED | Fake camera capture produced a 4.84s 1920x1080 VP9/Opus clip persisted in IndexedDB. |
| pause-resume | RUNTIME_VERIFIED | recording-smoke.mjs pauses and resumes; elapsed time excludes paused spans. |
| screenshot-capture | RUNTIME_VERIFIED | Live display stream drew real pixels into canvas; 1920x1080 image saved and previewed. |
| library-persistence | RUNTIME_VERIFIED | IndexedDB objects survive full reload; blob URLs are recreated on hydrate. |
| video-trim | RUNTIME_VERIFIED | Trim re-encodes a range to a new item, patches WebM duration and keeps the original. |
| webm-duration | RUNTIME_VERIFIED | EBML Info>Duration injected; browser reports finite duration instead of Infinity. |
| export-download | RUNTIME_VERIFIED | Download produced a file starting with EBML magic 1a45dfa3. |
| favorites | BUILD_VERIFIED | Favorite flag persisted through libraryStore.setFavorite; UI filter is wired. |
| settings-persistence | RUNTIME_VERIFIED | Theme and language survive reload; document root receives theme/lang/dir. |
| rtl-arabic | RUNTIME_VERIFIED | Language toggle sets lang=ar dir=rtl with no horizontal overflow. |
| high-dpi | RUNTIME_VERIFIED | deviceScaleFactor 1.25 and 1.5 rendered without overflow. |
| minimum-window | RUNTIME_VERIFIED | 1024x700 viewport has no horizontal overflow. |
| reduced-motion | RUNTIME_VERIFIED | prefers-reduced-motion collapses animation durations. |
| navigation-history | RUNTIME_VERIFIED | ui-smoke.mjs verifies back returns to recorder and forward to library. |
| permission-error | RUNTIME_VERIFIED | Denied camera shows an error notice, no fake preview, and Dismiss restores ready state. |

## Offline AI catalog (38)

| ID | English name | Category | Model | Status |
| --- | --- | --- | --- | --- |
| remove_background | Remove Background | image | /models/u2net/model.json | MISSING_MODEL |
| upscale_image | Image Upscaler | image | /models/real_esrgan/model.json | MISSING_MODEL |
| enhance_image | Photo Enhancer | image | /models/real_esrgan/model.json | MISSING_MODEL |
| detect_objects | Object Detection | image | /models/yolo/model.json | MISSING_MODEL |
| detect_faces | Face Detection | image | /models/face_detection/model.json | MISSING_MODEL |
| face_swap | Face Swap | image | /models/simswap/model.json | MISSING_MODEL |
| colorize_image | Colorize Old Photos | image | /models/stable_diffusion/model.json | MISSING_MODEL |
| toonify_image | Toonify Image | image | /models/stable_diffusion/model.json | MISSING_MODEL |
| enhance_face | Face Enhancement | image | /models/real_esrgan/model.json | MISSING_MODEL |
| edge_detection | Edge Detection | image | /models/yolo/model.json | MISSING_MODEL |
| track_objects | Object Tracking | video | /models/yolo/model.json | MISSING_MODEL |
| extract_scenes | Scene Extraction | video | /models/scenecut/model.json | MISSING_MODEL |
| stabilize_video | Video Stabilization | video | /models/yolo/model.json | MISSING_MODEL |
| enhance_video | Video Enhancement | video | /models/real_esrgan/model.json | MISSING_MODEL |
| detect_motion | Motion Detection | video | /models/yolo/model.json | MISSING_MODEL |
| analyze_fps | FPS Analyzer | video | /models/scenecut/model.json | MISSING_MODEL |
| extract_audio | Audio Extraction | video | /models/whisper/model.json | MISSING_MODEL |
| video_filters | Video Filters | video | /models/stable_diffusion/model.json | MISSING_MODEL |
| extract_faces_video | Video Face Extraction | video | /models/face_detection/model.json | MISSING_MODEL |
| extract_frames | Frame Extraction | video | /models/scenecut/model.json | MISSING_MODEL |
| separate_audio | Audio Separation | audio | /models/spleeter/model.json | MISSING_MODEL |
| enhance_voice | Voice Enhancement | audio | /models/rnnoise/model.json | MISSING_MODEL |
| detect_silence | Silence Detection | audio | /models/beat_detector/model.json | MISSING_MODEL |
| speech_to_text | Speech to Text | audio | /models/whisper/model.json | MISSING_MODEL |
| change_pitch | Voice Pitch Changer | audio | /models/sovits/model.json | MISSING_MODEL |
| generate_spectrogram | Spectrogram Generator | audio | /models/beat_detector/model.json | MISSING_MODEL |
| noise_profiler | Noise Profiler | audio | /models/rnnoise/model.json | MISSING_MODEL |
| reverse_audio | Audio Reversal | audio | /models/beat_detector/model.json | MISSING_MODEL |
| frequency_filter | Frequency Filter | audio | /models/rnnoise/model.json | MISSING_MODEL |
| audio_converter | Audio Converter | audio | /models/beat_detector/model.json | MISSING_MODEL |
| ocr_extract | OCR Text Extraction | text | /models/whisper/model.json | MISSING_MODEL |
| text_summarizer | Text Summarizer | text | /models/gpt4all/model.json | MISSING_MODEL |
| sentiment_analysis | Sentiment Analysis | text | /models/gpt4all/model.json | MISSING_MODEL |
| local_speech_to_text | Local Speech to Text | text | /models/whisper/model.json | MISSING_MODEL |
| text_generator | Text Generator | text | /models/gpt4all/model.json | MISSING_MODEL |
| language_detector | Language Detector | text | /models/m2m100/model.json | MISSING_MODEL |
| document_classifier | Document Classifier | text | /models/gpt4all/model.json | MISSING_MODEL |
| file_analyzer | Comprehensive File Analyzer | analysis | /models/yolo/model.json | MISSING_MODEL |

## Arabic AI catalog (38)

| ID | Title | Model size (MB) | Minutes | Status |
| --- | --- | --- | --- | --- |
| arabic-ai-01 | إزالة الخلفية | 95 | 3 | MISSING_ENGINE |
| arabic-ai-02 | استخراج الصوت | 85 | 10 | MISSING_ENGINE |
| arabic-ai-03 | استخراج المشاهد | 50 | 20 | MISSING_ENGINE |
| arabic-ai-04 | استخراج النص من الصور | 85 | 8 | MISSING_ENGINE |
| arabic-ai-05 | استخراج الوجوه من الفيديو | 10 | 35 | MISSING_ENGINE |
| arabic-ai-06 | تبديل الوجوه | 320 | 15 | MISSING_ENGINE |
| arabic-ai-07 | تتبع الأجسام | 45 | 30 | MISSING_ENGINE |
| arabic-ai-08 | تثبيت الفيديو | 45 | 45 | MISSING_ENGINE |
| arabic-ai-09 | تحسين الصوت البشري | 15 | 15 | MISSING_ENGINE |
| arabic-ai-10 | تحسين الوجه والجلد | 150 | 8 | MISSING_ENGINE |
| arabic-ai-11 | تحسين جودة الصور | 150 | 5 | MISSING_ENGINE |
| arabic-ai-12 | تحسين جودة الفيديو | 150 | 60 | MISSING_ENGINE |
| arabic-ai-13 | تحليل المشاعر | 120 | 5 | MISSING_ENGINE |
| arabic-ai-14 | تحليل معدل الإطارات | 50 | 5 | MISSING_ENGINE |
| arabic-ai-15 | تحويل الكلام المحلي | 85 | 12 | MISSING_ENGINE |
| arabic-ai-16 | تحويل الكلام إلى نص | 85 | 20 | MISSING_ENGINE |
| arabic-ai-17 | تحويل إلى رسمة | 2500 | 18 | MISSING_ENGINE |
| arabic-ai-18 | تحويل فيديو إلى صور | 50 | 15 | MISSING_ENGINE |
| arabic-ai-19 | تغيير نغمة الصوت | 220 | 25 | MISSING_ENGINE |
| arabic-ai-20 | تكبير الصور | 150 | 8 | MISSING_ENGINE |
| arabic-ai-21 | تلوين الصور القديمة | 2500 | 20 | MISSING_ENGINE |
| arabic-ai-22 | توليد طيف ترددي | 25 | 10 | MISSING_ENGINE |
| arabic-ai-23 | عكس الصوت | 25 | 5 | MISSING_ENGINE |
| arabic-ai-24 | فصل الصوت والموسيقى | 150 | 30 | MISSING_ENGINE |
| arabic-ai-25 | فلاتر الفيديو | 2500 | 40 | MISSING_ENGINE |
| arabic-ai-26 | كاشف اللغة | 420 | 3 | MISSING_ENGINE |
| arabic-ai-27 | كشف الأجسام | 45 | 2 | MISSING_ENGINE |
| arabic-ai-28 | كشف الحركة | 45 | 25 | MISSING_ENGINE |
| arabic-ai-29 | كشف الحواف والتفاصيل | 45 | 2 | MISSING_ENGINE |
| arabic-ai-30 | كشف الوجوه | 10 | 1 | MISSING_ENGINE |
| arabic-ai-31 | كشف فترات الصمت | 25 | 8 | MISSING_ENGINE |
| arabic-ai-32 | محلل الضوضاء | 15 | 12 | MISSING_ENGINE |
| arabic-ai-33 | محلل الملفات الشامل | 45 | 5 | MISSING_ENGINE |
| arabic-ai-34 | محول الصوت | 25 | 6 | MISSING_ENGINE |
| arabic-ai-35 | مرشح الترددات | 15 | 8 | MISSING_ENGINE |
| arabic-ai-36 | مصنف الوثائق | 120 | 10 | MISSING_ENGINE |
| arabic-ai-37 | ملخص النصوص | 120 | 15 | MISSING_ENGINE |
| arabic-ai-38 | مولد النصوص | 120 | 20 | MISSING_ENGINE |

## Visual Patch (50)

| ID | English name | Category | Status |
| --- | --- | --- | --- |
| body-scale-full-enlarge | Enlarge Full Body | body-scale | MISSING_ENGINE |
| body-scale-full-shrink | Shrink Full Body | body-scale | MISSING_ENGINE |
| body-scale-upper-enlarge | Enlarge Upper Body | body-scale | MISSING_ENGINE |
| body-scale-lower-enlarge | Enlarge Lower Body | body-scale | MISSING_ENGINE |
| body-scale-height-extend | Extend Height | body-scale | MISSING_ENGINE |
| body-scale-height-compress | Compress Height | body-scale | MISSING_ENGINE |
| body-scale-width-expand | Expand Width | body-scale | MISSING_ENGINE |
| body-scale-width-narrow | Narrow Width | body-scale | MISSING_ENGINE |
| waist-slim | Slim Waist | waist-belly | MISSING_ENGINE |
| belly-flatten | Flatten Belly | waist-belly | MISSING_ENGINE |
| waist-curves-enhance | Enhance Waist Curves | waist-belly | MISSING_ENGINE |
| belly-enhance | Enhance Belly | waist-belly | MISSING_ENGINE |
| torso-tighten | Tighten Torso | waist-belly | MISSING_ENGINE |
| hips-lower | Lower Hips | waist-belly | MISSING_ENGINE |
| chest-lift | Lift Chest | chest | MISSING_ENGINE |
| chest-reduce | Reduce Chest | chest | MISSING_ENGINE |
| chest-enhance | Enhance Chest | chest | MISSING_ENGINE |
| chest-reshape | Reshape Chest | chest | MISSING_ENGINE |
| chest-balance | Balance Chest | chest | MISSING_ENGINE |
| chest-flatten | Flatten Chest | chest | MISSING_ENGINE |
| hips-enhance | Enhance Hips | hips-thighs | MISSING_ENGINE |
| butt-lift | Lift Butt | hips-thighs | MISSING_ENGINE |
| hips-slim | Slim Hips | hips-thighs | MISSING_ENGINE |
| thighs-smooth | Smooth Thighs | hips-thighs | MISSING_ENGINE |
| thighs-slim | Slim Thighs | hips-thighs | MISSING_ENGINE |
| hips-shape | Shape Hips | hips-thighs | MISSING_ENGINE |
| legs-lengthen | Lengthen Legs | legs-feet | MISSING_ENGINE |
| legs-shorten | Shorten Legs | legs-feet | MISSING_ENGINE |
| legs-slim | Slim Legs | legs-feet | MISSING_ENGINE |
| legs-bulk | Bulk Legs | legs-feet | MISSING_ENGINE |
| knees-adjust | Adjust Knee Curves | legs-feet | MISSING_ENGINE |
| ankles-slim | Slim Ankles | legs-feet | MISSING_ENGINE |
| arms-slim | Slim Arms | arms-shoulders | MISSING_ENGINE |
| arms-bulk | Bulk Arms | arms-shoulders | MISSING_ENGINE |
| shoulders-adjust | Adjust Shoulders | arms-shoulders | MISSING_ENGINE |
| elbows-smooth | Smooth Elbows | arms-shoulders | MISSING_ENGINE |
| hands-slim | Slim Hands | arms-shoulders | MISSING_ENGINE |
| arms-lengthen | Lengthen Arms | arms-shoulders | MISSING_ENGINE |
| face-resize | Resize Face | head-face | MISSING_ENGINE |
| cheeks-lift | Lift Cheeks | head-face | MISSING_ENGINE |
| jaw-slim | Slim Jaw | head-face | MISSING_ENGINE |
| forehead-widen | Widen Forehead | head-face | MISSING_ENGINE |
| ears-adjust | Adjust Ears | head-face | MISSING_ENGINE |
| face-symmetry | Face Symmetry | head-face | MISSING_ENGINE |
| freeform-brush | Manual Brush | freeform | MISSING_ENGINE |
| freeform-warp | Free Warp | freeform | MISSING_ENGINE |
| freeform-curve | Curve Tool | freeform | MISSING_ENGINE |
| freeform-mirror | Mirror/Flip | freeform | MISSING_ENGINE |
| freeform-highlighter | Before/After Highlighter | freeform | MISSING_ENGINE |
| freeform-reset | Reset Areas | freeform | MISSING_ENGINE |

## MorphCore (50)

| ID | English name | Category | Executable | Status |
| --- | --- | --- | --- | --- |
| resize_body | Resize Body | body_scale | resize_body.exe | MISSING_ENGINE |
| enlarge_upper_body | Enlarge Upper Body | body_scale | enlarge_upper_body.exe | MISSING_ENGINE |
| enlarge_lower_body | Enlarge Lower Body | body_scale | enlarge_lower_body.exe | MISSING_ENGINE |
| shrink_body | Shrink Body | body_scale | shrink_body.exe | MISSING_ENGINE |
| extend_height | Extend Height | body_scale | extend_height.exe | MISSING_ENGINE |
| shorten_height | Shorten Height | body_scale | shorten_height.exe | MISSING_ENGINE |
| widen_body | Widen Body | body_scale | widen_body.exe | MISSING_ENGINE |
| narrow_body | Narrow Body | body_scale | narrow_body.exe | MISSING_ENGINE |
| shrink_waist | Shrink Waist | waist_tools | shrink_waist.exe | MISSING_ENGINE |
| flatten_belly | Flatten Belly | waist_tools | flatten_belly.exe | MISSING_ENGINE |
| curve_waist | Curve Waist | waist_tools | curve_waist.exe | MISSING_ENGINE |
| expand_belly | Expand Belly | waist_tools | expand_belly.exe | MISSING_ENGINE |
| tighten_core | Tighten Core | waist_tools | tighten_core.exe | MISSING_ENGINE |
| drop_hips | Drop Hips | waist_tools | drop_hips.exe | MISSING_ENGINE |
| lift_chest | Lift Chest | chest_tools | lift_chest.exe | MISSING_ENGINE |
| shrink_chest | Shrink Chest | chest_tools | shrink_chest.exe | MISSING_ENGINE |
| enlarge_chest | Enlarge Chest | chest_tools | enlarge_chest.exe | MISSING_ENGINE |
| reshape_chest | Reshape Chest | chest_tools | reshape_chest.exe | MISSING_ENGINE |
| symmetry_chest | Symmetry Chest | chest_tools | symmetry_chest.exe | MISSING_ENGINE |
| flatten_chest | Flatten Chest | chest_tools | flatten_chest.exe | MISSING_ENGINE |
| enlarge_hips | Enlarge Hips | hips_tools | enlarge_hips.exe | MISSING_ENGINE |
| lift_hips | Lift Hips | hips_tools | lift_hips.exe | MISSING_ENGINE |
| shrink_hips | Shrink Hips | hips_tools | shrink_hips.exe | MISSING_ENGINE |
| smooth_thighs | Smooth Thighs | hips_tools | smooth_thighs.exe | MISSING_ENGINE |
| slim_thighs | Slim Thighs | hips_tools | slim_thighs.exe | MISSING_ENGINE |
| enhance_hips_shape | enhance Hips Shape | hips_tools | enhance_hips_shape.exe | MISSING_ENGINE |
| lengthen_legs | Lengthen Legs | legs_tools | lengthen_legs.exe | MISSING_ENGINE |
| shorten_legs | Shorten Legs | legs_tools | shorten_legs.exe | MISSING_ENGINE |
| slim_legs | Slim Legs | legs_tools | slim_legs.exe | MISSING_ENGINE |
| thicken_legs | Thicken Legs | legs_tools | thicken_legs.exe | MISSING_ENGINE |
| adjust_knees | Adjust Knees | legs_tools | adjust_knees.exe | MISSING_ENGINE |
| reduce_ankles | Reduce Ankles | legs_tools | reduce_ankles.exe | MISSING_ENGINE |
| tone_arms | Tone Arms | arms_tools | tone_arms.exe | MISSING_ENGINE |
| bulk_arms | Bulk Arms | arms_tools | bulk_arms.exe | MISSING_ENGINE |
| resize_shoulders | Resize Shoulders | arms_tools | resize_shoulders.exe | MISSING_ENGINE |
| smooth_elbows | Smooth Elbows | arms_tools | smooth_elbows.exe | MISSING_ENGINE |
| shrink_hands | Shrink Hands | arms_tools | shrink_hands.exe | MISSING_ENGINE |
| stretch_arms | Stretch Arms | arms_tools | stretch_arms.exe | MISSING_ENGINE |
| resize_face | Resize Face | face_tools | resize_face.exe | MISSING_ENGINE |
| lift_cheeks | Lift Cheeks | face_tools | lift_cheeks.exe | MISSING_ENGINE |
| shrink_jaw | Shrink Jaw | face_tools | shrink_jaw.exe | MISSING_ENGINE |
| widen_forehead | Widen Forehead | face_tools | widen_forehead.exe | MISSING_ENGINE |
| adjust_ears | Adjust Ears | face_tools | adjust_ears.exe | MISSING_ENGINE |
| symmetry_face | Symmetry Face | face_tools | symmetry_face.exe | MISSING_ENGINE |
| mirror_flip | Mirror Flip | misc_tools | mirror_flip.exe | MISSING_ENGINE |
| manual_sculpt | Manual Sculpt | misc_tools | manual_sculpt.exe | MISSING_ENGINE |
| warp_tool | Warp Tool | misc_tools | warp_tool.exe | MISSING_ENGINE |
| curve_tool | Curve Tool | misc_tools | curve_tool.exe | MISSING_ENGINE |
| reset_body | Reset Body | misc_tools | reset_body.exe | MISSING_ENGINE |
| area_highlighter | Area Highlighter | misc_tools | area_highlighter.exe | MISSING_ENGINE |

## Toolbox (8)

| ID | Name | Status |
| --- | --- | --- |
| image-resizer | Image Resizer | BLOCKED |
| image-filter | Image Filters | BLOCKED |
| image-format-converter | Format Converter | BLOCKED |
| video-thumbnail | Video Thumbnail | BLOCKED |
| audio-visualizer | Audio Visualizer | BLOCKED |
| text-generator | Text Image Generator | BLOCKED |
| qr-generator | QR Code Generator | BLOCKED |
| color-palette | Color Palette Extractor | BLOCKED |

## Templates (5 base + 51 generated)

Base: modern-intro-1, neon-intro-2, minimalist-outro-1, education-slide-1, business-promo-1

Generated entries are explicitly tagged `dummy`/`generated` by the source and are recorded as `MOCK`.

## Models (24)

| ID | Manifest | Expected weights | Weights present | Status |
| --- | --- | --- | --- | --- |
| animatediff | public/models/animatediff/model.json | public/models/animatediff/weights.bin | false | MISSING_MODEL |
| bark_tts | public/models/bark_tts/model.json | public/models/bark_tts/weights.bin | false | MISSING_MODEL |
| beat_detector | public/models/beat_detector/model.json | public/models/beat_detector/weights.bin | false | MISSING_MODEL |
| face_detection | public/models/face_detection/model.json | public/models/face_detection/weights.bin | false | MISSING_MODEL |
| gpt4all | public/models/gpt4all/model.json | public/models/gpt4all/weights.bin | false | MISSING_MODEL |
| llama2 | public/models/llama2/model.json | public/models/llama2/weights.bin | false | MISSING_MODEL |
| m2m100 | public/models/m2m100/model.json | public/models/m2m100/weights.bin | false | MISSING_MODEL |
| modnet | public/models/modnet/model.json | public/models/modnet/weights.bin | false | MISSING_MODEL |
| real_esrgan | public/models/real_esrgan/model.json | public/models/real_esrgan/weights.bin | false | MISSING_MODEL |
| rnnoise | public/models/rnnoise/model.json | public/models/rnnoise/weights.bin | false | MISSING_MODEL |
| sadtalker | public/models/sadtalker/model.json | public/models/sadtalker/weights.bin | false | MISSING_MODEL |
| sam | public/models/sam/model.json | public/models/sam/weights.bin | false | MISSING_MODEL |
| scenecut | public/models/scenecut/model.json | public/models/scenecut/weights.bin | false | MISSING_MODEL |
| selfie_segmentation | public/models/selfie_segmentation/model.json | public/models/selfie_segmentation/weights.bin | false | MISSING_MODEL |
| simswap | public/models/simswap/model.json | public/models/simswap/weights.bin | false | MISSING_MODEL |
| sovits | public/models/sovits/model.json | public/models/sovits/weights.bin | false | MISSING_MODEL |
| spleeter | public/models/spleeter/model.json | public/models/spleeter/weights.bin | false | MISSING_MODEL |
| stable_diffusion | public/models/stable_diffusion/model.json | public/models/stable_diffusion/weights.bin | false | MISSING_MODEL |
| super_resolution | public/models/super_resolution/model.json | public/models/super_resolution/weights.bin | false | MISSING_MODEL |
| u2net | public/models/u2net/model.json | public/models/u2net/weights.bin | false | MISSING_MODEL |
| videocrafter | public/models/videocrafter/model.json | public/models/videocrafter/weights.bin | false | MISSING_MODEL |
| wav2lip | public/models/wav2lip/model.json | public/models/wav2lip/weights.bin | false | MISSING_MODEL |
| whisper | public/models/whisper/model.json | public/models/whisper/weights.bin | false | MISSING_MODEL |
| yolo | public/models/yolo/model.json | public/models/yolo/weights.bin | false | MISSING_MODEL |
