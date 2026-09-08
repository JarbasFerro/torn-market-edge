from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
base_path = ROOT / "scripts" / "apply_v021_hardening.py"
source = base_path.read_text(encoding="utf-8")

wrong_queue_patch = '''s = replace_once(
    s,
    ''' + "'''          priority,\n          onCached: (cached) => {'''" + ''',
    ''' + "'''          priority,\n          queueGroup,\n          onCached: (cached) => {'''" + ''',
    "queue group snapshot load",
)
'''

wrong_catch_patch = '''s = replace_once(
    s,
    ''' + "'''      } catch (error) {\n        if (!renderedCached && visible.card?.isConnected) renderInlineError(visible, error.message);\n        else log(\"Refresh failed; keeping cached row\", visible.itemId, error.message);\n      } finally {\n        if (visible.card?.dataset?.meScanning === String(visible.itemId)) delete visible.card.dataset.meScanning;\n      }'''" + ''',
    ''' + "'''      } catch (error) {\n        if (error?.marketEdgeCanceled) return;\n        if (!renderedCached && visible.card?.isConnected) renderInlineError(visible, error.message);\n        else log(\"Refresh failed; keeping cached row\", visible.itemId, error.message);\n      } finally {\n        if (visible.card?.dataset?.meScanning === String(visible.itemId) && visible.card.dataset.meScanningGroup === queueGroup) {\n          delete visible.card.dataset.meScanning;\n          delete visible.card.dataset.meScanningGroup;\n        }\n      }'''" + ''',
    "canceled request handling",
)
'''

if wrong_queue_patch not in source:
    raise RuntimeError("Could not locate misplaced queue-group patch in base script")
if wrong_catch_patch not in source:
    raise RuntimeError("Could not locate misplaced canceled-request patch in base script")
source = source.replace(wrong_queue_patch, "", 1)
source = source.replace(wrong_catch_patch, "", 1)

marker = 'p = "src/parts/07.part.js"\ns = read(p)\n'
if marker not in source:
    raise RuntimeError("Could not locate part 07 patch marker")

part07_runtime_patches = r'''p = "src/parts/07.part.js"
s = read(p)
s = replace_once(
    s,
    '''          priority,
          onCached: (cached) => {''',
    '''          priority,
          queueGroup,
          onCached: (cached) => {''',
    "queue group snapshot load",
)
s = replace_once(
    s,
    '''      } catch (error) {
        if (!renderedCached && visible.card?.isConnected) renderInlineError(visible, error.message);
        else log("Refresh failed; keeping cached row", visible.itemId, error.message);
      } finally {
        if (visible.card?.dataset?.meScanning === String(visible.itemId)) delete visible.card.dataset.meScanning;
      }''',
    '''      } catch (error) {
        if (error?.marketEdgeCanceled) return;
        if (!renderedCached && visible.card?.isConnected) renderInlineError(visible, error.message);
        else log("Refresh failed; keeping cached row", visible.itemId, error.message);
      } finally {
        if (visible.card?.dataset?.meScanning === String(visible.itemId) && visible.card.dataset.meScanningGroup === queueGroup) {
          delete visible.card.dataset.meScanning;
          delete visible.card.dataset.meScanningGroup;
        }
      }''',
    "canceled request handling",
)
'''

source = source.replace(marker, part07_runtime_patches, 1)
exec(compile(source, str(base_path), "exec"), {"__file__": str(base_path), "__name__": "__main__"})
