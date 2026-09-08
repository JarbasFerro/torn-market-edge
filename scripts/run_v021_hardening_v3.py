from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
base_path = ROOT / "scripts" / "apply_v021_hardening.py"
source = base_path.read_text(encoding="utf-8")


def remove_replace_block(text, label):
    label_marker = f'    "{label}",\n)\n'
    end = text.find(label_marker)
    if end < 0:
        raise RuntimeError(f"Could not find patch label: {label}")
    end += len(label_marker)
    start = text.rfind("s = replace_once(\n", 0, end)
    if start < 0:
        raise RuntimeError(f"Could not find patch block start: {label}")
    return text[:start] + text[end:]


# These edits belong to part 07 because the scan function crosses the source-part
# boundary. Remove the misplaced attempts from the original one-time patch.
source = remove_replace_block(source, "queue group snapshot load")
source = remove_replace_block(source, "canceled request handling")

marker = 'p = "src/parts/07.part.js"\ns = read(p)\n'
if marker not in source:
    raise RuntimeError("Could not find part 07 patch marker")

part07_runtime_patches = """p = \"src/parts/07.part.js\"
s = read(p)
s = replace_once(
    s,
    '''          priority,
          onCached: (cached) => {''',
    '''          priority,
          queueGroup,
          onCached: (cached) => {''',
    \"queue group snapshot load\",
)
s = replace_once(
    s,
    '''      } catch (error) {
        if (!renderedCached && visible.card?.isConnected) renderInlineError(visible, error.message);
        else log(\"Refresh failed; keeping cached row\", visible.itemId, error.message);
      } finally {
        if (visible.card?.dataset?.meScanning === String(visible.itemId)) delete visible.card.dataset.meScanning;
      }''',
    '''      } catch (error) {
        if (error?.marketEdgeCanceled) return;
        if (!renderedCached && visible.card?.isConnected) renderInlineError(visible, error.message);
        else log(\"Refresh failed; keeping cached row\", visible.itemId, error.message);
      } finally {
        if (visible.card?.dataset?.meScanning === String(visible.itemId) && visible.card.dataset.meScanningGroup === queueGroup) {
          delete visible.card.dataset.meScanning;
          delete visible.card.dataset.meScanningGroup;
        }
      }''',
    \"canceled request handling\",
)
"""

source = source.replace(marker, part07_runtime_patches, 1)
exec(compile(source, str(base_path), "exec"), {"__file__": str(base_path), "__name__": "__main__"})
