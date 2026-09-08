      `<span class="me-inline-brand">ME</span><span class="me-inline-secondary">${escapeHtml(message)}</span><span class="me-inline-status">ERROR</span>`,
      "RED"
    );
  }

  function staleMarker(result) {
    return result?.renderMeta?.stale ? `<span class="me-inline-stale" title="Showing cached data while Market Edge refreshes">*</span>` : "";
  }

  function setBazaarInputValue(input, value) {
    if (!(input instanceof HTMLInputElement)) return false;
    const target = Math.max(1, asInt(value));
    if (!target) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(input, String(target));
    else input.value = String(target);
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    return parseIntegerField(input.value) === target;
  }

  function renderBazaarAddSuggestion(result) {
    const visible = result.visible;
    const source = result?.sellForm || result?.ownBazaar || {};
    const target = source.target;
    const stale = staleMarker(result);
    const venue = result?.sellForm ? "Item Market" : "Bazaar";
    if (!Number.isFinite(target) || target <= 0) {
      return renderInlineHtml(
        visible,
        `<span class="me-inline-brand">ME</span><span class="me-inline-secondary">${escapeHtml(source.reason || "price unavailable")}</span>${stale}`,
        "GREY"
      );
    }

    const targetText = formatMoney(target);
    const pricing = source.equipmentPricing || null;
    const copyLabel = source.copyLabel || "";
    const netHtml = result?.sellForm && Number.isFinite(source.net)
      ? `<span class="me-inline-sep">|</span><span class="me-inline-secondary" title="Net per unit after the ${source.feeBps / 100}% Item Market fee">net ${formatMoney(source.net)}</span>`
      : "";
    const equipmentHtml = pricing
      ? equipmentContextHtml(pricing)
      : (copyLabel ? `<span class="me-inline-sep">|</span><span class="me-inline-secondary" title="Priced from this copy's details">${escapeHtml(copyLabel)}</span>` : "");
    const priceTitle = pricing
      ? `Suggested ${venue} price for a plain (no bonus) copy: ${formatMoney(target, true)}. ${equipmentContextTitle(pricing)}`
      : (copyLabel ? `Suggested ${venue} price for this copy (${copyLabel}): ${formatMoney(target, true)}` : `Suggested ${venue} selling price${source.floor ? ` (Item Market floor ${formatMoney(source.floor, true)})` : ""}`);
    const block = renderInlineHtml(
      visible,
      `<span class="me-inline-brand">ME</span><span class="me-inline-primary" title="${escapeHtml(priceTitle)}">${targetText}</span><button class="me-bazaar-fill-btn" type="button" aria-label="Fill price and maximum quantity" title="Fill price with ${escapeHtml(targetText)} and quantity with max available; ${escapeHtml(venue === "Bazaar" ? "ADD TO BAZAAR" : "listing")} stays manual">^</button>${netHtml}${equipmentHtml}${stale}`,
      "GREY",
      "me-bazaar-add"
    );
    const button = block?.querySelector?.(".me-bazaar-fill-btn");
    if (!button || !visible.priceInput) return block;

    const apply = () => {
      if (!visible.priceInput?.isConnected) return;
      const priceFilled = setBazaarInputValue(visible.priceInput, target);
      const maxAvailable = Math.max(1, asInt(visible.maxAvailable || visible.quantity, 1));
      let quantityFilled = false;
      if (visible.quantityCheckbox?.isConnected) {
        if (!visible.quantityCheckbox.checked) visible.quantityCheckbox.click();
        quantityFilled = Boolean(visible.quantityCheckbox.checked);
      } else if (visible.quantityInput?.isConnected) {
        quantityFilled = setBazaarInputValue(visible.quantityInput, maxAvailable);
        visible.quantityInput.dispatchEvent(new Event("keyup", { bubbles: true, composed: true }));
      }
      if (!priceFilled) return;
      visible.price = target;
      block.classList.add("me-applied");
      button.title = quantityFilled
        ? `Filled ${maxAvailable} units at ${targetText}`
        : `Price filled with ${targetText}; quantity field was not detected`;
      setTimeout(() => block?.classList?.remove("me-applied"), 700);
    };
    // "Fill all" from the menu reuses the same handler without synthesising
    // a click on any element.
    button.meFill = apply;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      apply();
    });
    return block;
  }

  function equipmentContextTitle(pricing) {
    const parts = [
      pricing.plainFloor ? `Cheapest plain Item Market listing: ${formatMoney(pricing.plainFloor, true)}` : "No plain Item Market listing found",
      pricing.plainMedian ? `Plain listing median: ${formatMoney(pricing.plainMedian, true)}` : "",
      pricing.averagePrice ? `Torn daily average: ${formatMoney(pricing.averagePrice, true)}` : "",
      pricing.salesMedian ? `Ended Auction House sales (30d, plain): median ${formatMoney(pricing.salesMedian, true)} over ${pricing.salesCount}` : "No plain Auction House sales in 30 days",
      pricing.bonusFloor ? `Bonus/rarity copies list from ${formatMoney(pricing.bonusFloor, true)}; if yours has a bonus, price it on the Item Market page instead` : "",
      `Item Market alternative: ${formatMoney(pricing.itemMarketSuggested, true)} (net ${formatMoney(pricing.itemMarketNet, true)} after ${pricing.feeBps / 100}%)`
    ].filter(Boolean);
    return parts.join("\n");
  }

  function equipmentContextHtml(pricing) {
    const bits = [];
    if (pricing.plainFloor) bits.push(`<span class="me-inline-secondary" title="Cheapest plain Item Market listing">floor ${formatMoney(pricing.plainFloor)}</span>`);
    if (pricing.salesMedian) bits.push(`<span class="me-inline-secondary" title="Median of ${pricing.salesCount} ended Auction House sales of plain copies in 30 days">AH ${formatMoney(pricing.salesMedian)}</span>`);
    else if (pricing.averagePrice) bits.push(`<span class="me-inline-secondary" title="Torn daily average">avg ${formatMoney(pricing.averagePrice)}</span>`);
    if (pricing.bonusFloor) bits.push(`<span class="me-inline-secondary" title="Cheapest listing with a bonus or rarity">bonus ${formatMoney(pricing.bonusFloor)}+</span>`);
    return bits.map((bit) => `<span class="me-inline-sep">|</span>${bit}`).join("");
  }

  function fillBazaarRowFromDetails(row, price) {
    if (!row || !Number.isFinite(price) || price <= 0) return { priceFilled: false, quantityFilled: false };
    const priceInput = findBazaarAddPriceInput(row);
    if (!priceInput) return { priceFilled: false, quantityFilled: false };
    const priceFilled = setBazaarInputValue(priceInput, price);
    let quantityFilled = false;
    const checkbox = findBazaarAddQuantityCheckbox(row);
    if (checkbox?.isConnected) {
      if (!checkbox.checked) checkbox.click();
      quantityFilled = Boolean(checkbox.checked);
    } else {
      const quantityInput = findBazaarAddQuantityInput(row, priceInput);
      if (quantityInput?.isConnected) {
        quantityFilled = setBazaarInputValue(quantityInput, 1);
        quantityInput.dispatchEvent(new Event("keyup", { bubbles: true, composed: true }));
      }
    }
    return { priceFilled, quantityFilled };
  }

  const cardPanels = new WeakMap();

  function renderEquipmentDetailCard(detail, pricing, { canFill = false, loading = false, error = "" } = {}) {
    const panel = detail?.panel;
    if (!panel?.isConnected) return null;
    removeDetailCards(detail);
    const card = document.createElement("div");
    card.className = "me-equip-card";
    card.dataset.meDetailKey = detail.key;
    card.dataset.meComplete = loading ? "0" : "1";
    // Torn's details wrapper may be a grid or flex container; make the card a
    // full-width block regardless of the parent's layout.
    card.style.cssText = "display:block;width:100%;box-sizing:border-box;grid-column:1 / -1;flex:0 0 100%;order:999;";

    const copy = detail.copy;
    const copyLabel = [
      Number.isFinite(copy.quality) ? `Q ${copy.quality.toFixed(1)}%` : null,
      copy.bonuses.length ? copy.bonuses.map((bonus) => `${bonus.title}${bonus.value ? ` ${bonus.value}%` : ""}`).join(" + ") : "plain (no bonus)",
      copy.rarity ? copy.rarity.toUpperCase() : null
    ].filter(Boolean).join(" · ");

    if (loading) {
      card.innerHTML = `<div class="me-equip-head"><span class="me-equip-brand">ME</span><span class="me-equip-alt">${escapeHtml(copyLabel)}</span><span class="me-equip-alt">pricing this copy...</span></div>`;
      detailCardHost(panel).appendChild(card);
      cardPanels.set(card, panel);
      return card;
    }

    if (error) {
      card.innerHTML = `<div class="me-equip-head"><span class="me-equip-brand">ME</span><span class="me-equip-alt">${escapeHtml(copyLabel)}</span></div><div class="me-equip-note me-equip-warn">${escapeHtml(error)} Collapse and reopen the details to retry.</div>`;
      detailCardHost(panel).appendChild(card);
      return card;
    }

    if (!pricing || !pricing.bazaarSuggested) {
      const groupCount = pricing?.group?.count || 0;
      card.innerHTML = `<div class="me-equip-head"><span class="me-equip-brand">ME</span><span class="me-equip-alt">${escapeHtml(copyLabel)}</span></div>
        <div class="me-equip-note">No comparable ${escapeHtml(pricing?.groupLabel || "listings")} ${groupCount ? "" : "are on the Item Market and no recent Auction House sales were found"}. Price this copy manually or check the Item Market page for the closest rolls.</div>`;
      detailCardHost(panel).appendChild(card);
      cardPanels.set(card, panel);
      return card;
    }

    const bandText = pricing.comparables.band
      ? `${pricing.comparables.count} listings within Q ±${pricing.comparables.band}`
      : `${pricing.comparables.count} listings in group (no quality match)`;
    const facts = [
      ["Comparables", `${pricing.comparables.floor ? `from ${formatMoney(pricing.comparables.floor)}, median ${formatMoney(pricing.comparables.median)}` : "-"} (${bandText})`],
      ["AH sold (30d)", pricing.sales.count ? `median ${formatMoney(pricing.sales.median)} over ${pricing.sales.count}` : "none for this group"],
      pricing.plain && pricing.averagePrice ? ["Torn average", formatMoney(pricing.averagePrice)] : null,
      ["Item Market", `${formatMoney(pricing.itemMarketSuggested)} (net ${formatMoney(pricing.itemMarketNet)} after ${pricing.feeBps / 100}%)`],
      pricing.plain && pricing.bonusFloor ? ["Bonus copies", `from ${formatMoney(pricing.bonusFloor)}`] : null
    ].filter(Boolean);

    const thin = pricing.comparables.count === 0 && pricing.sales.count < 3
      ? `<div class="me-equip-note me-equip-warn">Thin evidence: no ${escapeHtml(pricing.groupLabel)} listings and only ${pricing.sales.count} Auction House sale(s) in 30 days. Treat this as a rough guide.</div>`
      : "";
    const warn = thin + (pricing.cheaperAtSuggested > 0
      ? `<div class="me-equip-note me-equip-warn">${pricing.cheaperAtSuggested} ${escapeHtml(pricing.groupLabel)} listing(s) are cheaper than this price; they sell first.</div>`
      : "");
    const fill = canFill
      ? `<button class="me-bazaar-fill-btn" type="button" aria-label="Fill Bazaar price and select this item" title="Fill price with ${escapeHtml(formatMoney(pricing.bazaarSuggested, true))} and select this item">^</button>`
      : "";

    card.innerHTML = `
      <div class="me-equip-head">
        <span class="me-equip-brand">ME</span>
        <span class="me-equip-alt">${escapeHtml(copyLabel)}</span>
        <span class="me-equip-price" title="Suggested Bazaar price for this copy: ${escapeHtml(formatMoney(pricing.bazaarSuggested, true))}">${formatMoney(pricing.bazaarSuggested)}</span>
        ${fill}
        <span class="me-equip-alt">${escapeHtml(pricing.bestRoute)} is the better exit</span>
      </div>
      <div class="me-equip-facts">${facts.map(([label, value]) => `<span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span>`).join("")}</div>
      ${warn}
      <div class="me-equip-note">Reference ${formatMoney(pricing.reference)} from ${escapeHtml(pricing.referenceSource)}, minus safety haircut, never above the cheapest comparable. Estimates, not guarantees; ADD TO BAZAAR stays manual.</div>`;
    detailCardHost(panel).appendChild(card);
    cardPanels.set(card, panel);

    const button = card.querySelector(".me-bazaar-fill-btn");
    if (button && detail.row) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const outcome = fillBazaarRowFromDetails(detail.row, pricing.bazaarSuggested);
        if (!outcome.priceFilled) return;
        card.classList.add("me-applied");
        button.title = outcome.quantityFilled ? `Filled ${formatMoney(pricing.bazaarSuggested, true)} and selected this item` : `Price filled with ${formatMoney(pricing.bazaarSuggested, true)}; select the item manually`;
        setTimeout(() => card.classList.remove("me-applied"), 700);
      });
    }
    return card;
  }

  function renderInlineResult(surface, result, ownBazaar) {
    const visible = result.visible;
    if (!visible || !visible.card?.isConnected) return null;
    const stale = staleMarker(result);
    if (result.error) return renderInlineError(visible, result.error);
    if (result.untradable) {
      return renderInlineHtml(visible, `<span class="me-inline-brand">ME</span><span class="me-inline-secondary" title="Torn marks this item as not tradable">untradable</span>`, "GREY");
    }
    if (result.noListings) {
      const mv = result.snapshot?.averagePrice ? `MV ${formatMoney(result.snapshot.averagePrice)}` : "no market value";
      return renderInlineHtml(visible, `<span class="me-inline-brand">ME</span><span class="me-inline-secondary" title="No Item Market listings right now; Torn's market value is shown">${mv}</span><span class="me-inline-sep">|</span><span class="me-inline-secondary">no listings</span>${stale}`, "GREY");
    }
    if (result.equipmentRow) {
      // Sell-side weapon/armor row: exact copy when its uid was priced,
      // otherwise the plain/bonus floors with a hint to open the details.
      const row = result.equipmentRow;
      if (!row.pricing && asInt(visible.card?.dataset?.meCopyPrice, 0) > 0) {
        // This copy was already priced from its expanded details panel;
        // keep that price on the row instead of the generic floors.
        return renderInlineResult(surface, { ...result, equipmentRow: null, equipment: row.summary || { plainFloor: null, bonusFloor: null } }, ownBazaar);
      }
      if (row.pricing && row.copy) {
        const label = copyLabelFor(row.copy);
        const card = visible.card;
        if (card?.dataset) {
          card.dataset.meCopyPrice = String(row.pricing.bazaarSuggested || "");
          card.dataset.meCopyIm = String(row.pricing.itemMarketSuggested || "");
          card.dataset.meCopyLabel = label;
        }
        if (visible.bazaarAdd) {
          return renderBazaarAddSuggestion({
            ...result,
            sellForm: surface === "imsell" ? { target: row.pricing.itemMarketSuggested, net: row.pricing.itemMarketNet, feeBps: row.pricing.feeBps, copyLabel: label } : null,
            ownBazaar: surface === "imsell" ? null : { target: row.pricing.bazaarSuggested, copyLabel: label }
          });
        }
        const bz = row.pricing.bazaarSuggested ? formatMoney(row.pricing.bazaarSuggested) : "-";
        const im = row.pricing.itemMarketSuggested ? formatMoney(row.pricing.itemMarketSuggested) : "-";
        return renderInlineHtml(visible,
          `<span class="me-inline-brand">ME</span><span class="me-inline-primary" title="Suggested Bazaar price for this copy (priced by uid)">BZ ${bz}</span><span class="me-inline-sep">|</span><span class="me-inline-secondary">IM ${im}</span><span class="me-inline-sep">|</span><span class="me-inline-secondary">${escapeHtml(label)}</span>${stale}`,
          "GREY"
        );
      }
      const summary = row.summary || {};
      const plain = summary.plainFloor ? formatMoney(summary.plainFloor) : (result.snapshot?.averagePrice ? `MV ${formatMoney(result.snapshot.averagePrice)}` : "-");
      const bonusHtml = summary.bonusFloor ? `<span class="me-inline-sep">|</span><span class="me-inline-secondary" title="Cheapest listing with a bonus or rarity">bonus ${formatMoney(summary.bonusFloor)}+</span>` : "";
      return renderInlineHtml(visible,
        `<span class="me-inline-brand">ME</span><span class="me-inline-secondary" title="Cheapest plain (no bonus) listing on the Item Market; this copy's own quality and bonuses are unknown until its details are opened">floor ${plain}</span>${bonusHtml}<span class="me-inline-sep">|</span><span class="me-inline-secondary" title="Open this item's details to price this exact copy">open details to price</span>${stale}`,
        "GREY",
        visible.bazaarAdd ? "me-bazaar-add" : ""
      );
    }
    if (result.equipment) {
      // Weapons/armor on list pages. Sell-side surfaces (own Bazaar,
      // inventory) get a plain-copy sell price with context; buy-side
      // surfaces get the plain and bonus floors to compare against.
      const summary = result.equipment;
      const pricing = result.equipmentPricing || null;
      const copyPrice = asInt(visible.card?.dataset?.meCopyPrice, 0);
      const copyLabel = String(visible.card?.dataset?.meCopyLabel || "");
      if (surface === "bazaar" && ownBazaar && visible.bazaarAdd) {
        // Weapon rows carry no price until the copy has been priced from its
        // expanded details panel; then that copy's value and the fill control
        // move onto the row.
        if (copyPrice > 0) {
          return renderBazaarAddSuggestion({
            ...result,
            ownBazaar: { target: copyPrice, copyLabel }
          });
        }
        return renderInlineHtml(visible,
          `<span class="me-inline-brand">ME</span><span class="me-inline-secondary" title="Open this item's details to price this exact copy (quality and bonuses)">open details to price</span>${stale}`,
          "GREY",
          "me-bazaar-add"
        );
      }
      if (surface === "inventory" && copyPrice > 0) {
        const copyIm = asInt(visible.card?.dataset?.meCopyIm, 0);
        return renderInlineHtml(visible,
          `<span class="me-inline-brand">ME</span><span class="me-inline-primary" title="Suggested Bazaar price for this copy (${escapeHtml(copyLabel)})">BZ ${formatMoney(copyPrice)}</span>${copyIm ? `<span class="me-inline-sep">|</span><span class="me-inline-secondary">IM ${formatMoney(copyIm)}</span>` : ""}<span class="me-inline-sep">|</span><span class="me-inline-secondary">${escapeHtml(copyLabel)}</span>${stale}`,
          "GREY"
        );
      }
      if (surface === "inventory" || (surface === "bazaar" && ownBazaar)) {
        // Sell-side equipment without a priced copy: nothing to show. An
        // invisible completed marker stops rescans from re-processing the row.
        return renderInlineHtml(visible, "", "GREY", "me-hidden");
      }
      if (surface === "bazaar" && ownBazaar && pricing) {
        const delta = pricing.bazaarSuggested - visible.price;
        const state = delta > 0 ? "YELLOW" : "GREY";
        return renderInlineHtml(visible,
          `<span class="me-inline-brand">ME</span><span class="me-inline-primary" title="${escapeHtml(equipmentContextTitle(pricing))}">Target ${formatMoney(pricing.bazaarSuggested)}</span><span class="me-inline-sep">|</span><span class="me-inline-secondary">${delta >= 0 ? "+" : ""}${formatMoney(delta)}</span>${equipmentContextHtml(pricing)}<span class="me-inline-status">${delta > 0 ? "LOW" : "OK"}</span>${stale}`,
          state
        );
      }
      if (surface === "inventory" && pricing) {
        const bzClass = pricing.bestRoute === "Bazaar" ? "me-inline-primary" : "me-inline-secondary";
        const imClass = pricing.bestRoute === "Item Market" ? "me-inline-primary" : "me-inline-secondary";
        return renderInlineHtml(visible,
          `<span class="me-inline-brand">ME</span><span class="${bzClass}" title="${escapeHtml(equipmentContextTitle(pricing))}">BZ ${formatMoney(pricing.bazaarSuggested)}</span><span class="me-inline-sep">|</span><span class="${imClass}">IM ${formatMoney(pricing.itemMarketSuggested)}</span>${equipmentContextHtml(pricing)}${stale}`,
          "GREY"
        );
      }
      const plain = summary.plainFloor ? formatMoney(summary.plainFloor) : "-";
      const bonus = summary.bonusFloor ? formatMoney(summary.bonusFloor) : null;
      const bonusHtml = bonus ? `<span class="me-inline-sep">|</span><span class="me-inline-secondary" title="Cheapest listing with a bonus or rarity">bonus ${bonus}</span>` : "";
      return renderInlineHtml(visible,
        `<span class="me-inline-brand">ME</span><span class="me-inline-primary" title="Cheapest plain listing on the Item Market">floor ${plain}</span>${bonusHtml}${stale}`,
        "GREY"
      );
    }
    if (result.unsupported) {
      return renderInlineHtml(visible, `<span class="me-inline-brand">ME</span><span class="me-inline-secondary">unsupported equipment</span>`, "GREY");
    }

    if ((surface === "bazaar" && ownBazaar && visible.bazaarAdd) || (surface === "imsell" && result.sellForm)) {
      return renderBazaarAddSuggestion(result);
    }

    if (result.inventory) {
      const estimate = result.inventory;
      const bzValue = estimate?.routes?.bazaar ? formatMoney(estimate.routes.bazaar.suggestedPrice) : "off";
      const imValue = formatMoney(estimate?.routes?.itemMarket?.suggestedPrice);
      const best = estimate?.routes?.bestRoute;
      const bzClass = best === "Bazaar" ? "me-inline-primary" : "me-inline-secondary";
      const imClass = best === "Item Market" ? "me-inline-primary" : "me-inline-secondary";
      const museum = estimate?.routes?.museum;
      const setClass = best === "Museum set" ? "me-inline-primary" : "me-inline-secondary";
      const setHtml = museum
        ? `<span class="me-inline-sep">|</span><span class="${setClass}" title="Value implied by completing the ${escapeHtml(museum.label)} and exchanging it for points">SET ${formatMoney(museum.suggestedPrice)}</span>`
        : "";
      return renderInlineHtml(visible,
        `<span class="me-inline-brand">ME</span><span class="${bzClass}">BZ ${bzValue}</span><span class="me-inline-sep">|</span><span class="${imClass}">IM ${imValue}</span>${setHtml}${stale}`,
        "GREY"
      );
    }

    if (result.browse) {
      const data = result.browse;
      const discount = `${data.discount >= 0 ? "-" : "+"}${Math.abs(data.discount * 100).toFixed(1)}%`;
      const title = `Displayed price versus Torn's official market value ${formatMoney(data.marketPrice, true)}.${Number.isFinite(data.profitPerUnit) ? ` Estimated net per unit after fees via ${data.bestRoute}: ${formatMoney(data.profitPerUnit, true)}.` : ""} Open the item for order-book analysis.`;
      return renderInlineHtml(visible,
        `<span class="me-inline-brand">ME</span><span class="me-inline-primary" title="${escapeHtml(title)}">${discount} vs MV</span><span class="me-inline-status">${data.label}</span>${stale}`,
        data.state
      );
    }

    if (result.auctionEquipment) {
      const data = result.auctionEquipment;
      const headroomText = data.headroom > 0 ? `+${formatMoney(data.headroom)}` : (Number.isFinite(data.headroom) ? formatMoney(data.headroom) : "-");
      const title = [
        `Max rational bid for this copy (${data.label}): ${formatMoney(data.maxBid, true)}`,
        `Resale net used: ${formatMoney(data.bestNet, true)} (Bazaar ${formatMoney(data.pricing.bazaarSuggested, true)}, Item Market net ${formatMoney(data.pricing.itemMarketNet, true)})`,
        data.pricing.comparableCount ? `${data.pricing.comparableCount} comparable listings` : "No comparable listings",
        data.pricing.salesCount ? `${data.pricing.salesCount} ended Auction House sales of this group` : "No ended sales of this group in 30 days",
        data.pricing.thinEvidence ? "Thin evidence: treat as a floor check" : ""
      ].filter(Boolean).join("\n");
      return renderInlineHtml(visible,
        `<span class="me-inline-brand">ME</span><span class="me-inline-primary" title="${escapeHtml(title)}">Max ${formatMoney(data.maxBid)}</span><span class="me-inline-sep">|</span><span class="me-inline-secondary">${headroomText}</span><span class="me-inline-sep">|</span><span class="me-inline-secondary">${escapeHtml(data.label)}</span><span class="me-inline-status">${data.headroom > 0 ? "CONSIDER" : "PASS"}</span>${stale}`,
        data.state
      );
    }

    if (surface === "auction") {
      const data = result.auction;
      const state = data?.headroom > 0 ? "YELLOW" : "GREY";
      const headroomText = data?.headroom > 0 ? `+${formatMoney(data.headroom)}` : "-";
      const sales = data?.salesSummary;
      const salesHtml = sales?.count ? `<span class="me-inline-sep">|</span><span class="me-inline-secondary" title="Median of ${sales.count} ended Auction House sales in 30 days (range ${formatMoney(sales.low, true)} - ${formatMoney(sales.high, true)})">sold ${formatMoney(sales.median)}</span>` : "";
      return renderInlineHtml(visible,
        `<span class="me-inline-brand">ME</span><span class="me-inline-primary">Max ${formatMoney(data?.maxBid)}</span><span class="me-inline-sep">|</span><span class="me-inline-secondary">${headroomText}</span>${salesHtml}<span class="me-inline-status">${data?.headroom > 0 ? "CONSIDER" : "PASS"}</span>${stale}`,
        state
      );
    }

    if (surface === "bazaar" && ownBazaar) {
      const data = result.ownBazaar;
      const state = data?.delta > 0 ? "YELLOW" : "GREY";
      const deltaText = Number.isFinite(data?.delta) ? `${data.delta >= 0 ? "+" : ""}${formatMoney(data.delta)}` : "-";
      const fill = data?.fill || null;
      const fillPrice = fill?.price || null;
      const ruleLabel = data?.rule ? ` (rule: ${data.rule.mode}${data.rule.minPrice ? `, min ${formatMoney(data.rule.minPrice)}` : ""})` : "";
      const fillHtml = visible.priceInput && fillPrice
        ? `<button class="me-bazaar-fill-btn me-manage-fill" type="button" title="Fill Torn's price field with ${escapeHtml(formatMoney(fillPrice, true))}${escapeHtml(ruleLabel)}. Saving stays manual.">^</button>`
        : (fill?.reason === "held by rule" ? `<span class="me-inline-secondary" title="Pricing rule: hold">hold</span>` : "");
      const floorHtml = data?.floor ? `<span class="me-inline-sep">|</span><span class="me-inline-secondary" title="Cheapest Item Market listing">floor ${formatMoney(data.floor)}</span>` : "";
      const block = renderInlineHtml(visible,
        `<span class="me-inline-brand">ME</span><span class="me-inline-primary">Target ${formatMoney(data?.target)}</span><span class="me-inline-sep">|</span><span class="me-inline-secondary">${deltaText}</span>${floorHtml}${fillHtml}<span class="me-inline-status">${data?.delta > 0 ? "LOW" : "OK"}</span>${stale}`,
        state
      );
      const manageButton = block?.querySelector?.(".me-manage-fill");
      if (manageButton) {
        const applyManage = () => {
          if (!visible.priceInput?.isConnected || !fillPrice) return;
          if (setBazaarInputValue(visible.priceInput, fillPrice)) {
            visible.price = fillPrice;
            data.delta = data.target - fillPrice;
            block.classList.add("me-applied");
            setTimeout(() => block?.classList?.remove("me-applied"), 700);
          }
        };
        manageButton.meFill = applyManage;
        manageButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          applyManage();
        });
      }
      if (visible.priceInput && !visible.priceInput.dataset.mePriceListener) {
        visible.priceInput.dataset.mePriceListener = "1";
        visible.priceInput.addEventListener("input", () => {
          const currentPrice = parseIntegerField(visible.priceInput.value);
          if (!currentPrice || !Number.isFinite(data?.target)) return;
          visible.price = currentPrice;
          data.delta = data.target - currentPrice;
          renderInlineResult(surface, result, ownBazaar);
        });
      }
      return block;
    }

    const direct = result.direct;
    if (!direct) {
      return renderInlineHtml(visible, `<span class="me-inline-brand">ME</span><span class="me-inline-secondary">PASS</span>${stale}`, "GREY");
    }
    const state = direct.classification.state;
    const roi = `${direct.roi >= 0 ? "+" : ""}${(direct.roi * 100).toFixed(1)}%`;
    const profit = `${direct.expectedProfit >= 0 ? "+" : ""}${formatMoney(direct.expectedProfit)}`;

    if (surface === "cityshop") {
      const qty = Math.max(1, asInt(result.quantityUsed || 1, 1));
      const perUnit = Math.trunc(direct.expectedProfit / qty);
      const route = direct.routes?.bestRoute || "";
      return renderInlineHtml(visible,
        `<span class="me-inline-brand">ME</span><span class="me-inline-primary" title="Expected net profit per unit after fees via ${escapeHtml(route)}">${perUnit >= 0 ? "+" : ""}${formatMoney(perUnit)} ea</span><span class="me-inline-sep">|</span><span class="me-inline-secondary" title="For ${qty} units">${profit} / ${qty}</span><span class="me-inline-status">${CLASS_META[state].label}</span>${stale}`,
        state
      );
    }

    if (surface === "travel") {
      const qty = Math.max(1, asInt(result.quantityUsed || visible.quantity, 1));
      const perUnit = Math.trunc(direct.expectedProfit / qty);
      const trip = result.perItemOnly ? `ROI ${roi}` : `${profit} trip`;
      return renderInlineHtml(visible,
        `<span class="me-inline-brand">ME</span><span class="me-inline-primary">${perUnit >= 0 ? "+" : ""}${formatMoney(perUnit)} ea</span><span class="me-inline-sep">|</span><span class="me-inline-secondary">${trip}</span>${stale}`,
        state
      );
    }

    if (surface === "bazaar") {
      return renderInlineHtml(visible,
        `<span class="me-inline-brand">ME</span><span class="me-inline-primary">${roi}</span><span class="me-inline-sep">|</span><span class="me-inline-secondary">${profit}</span><span class="me-inline-status">${CLASS_META[state].label}</span>${stale}`,
        state
      );
    }

    return renderInlineHtml(visible,
      `<span class="me-inline-brand">ME</span><span class="me-inline-primary">${roi}</span><span class="me-inline-sep">|</span><span class="me-inline-secondary">${profit}</span><span class="me-inline-status">${CLASS_META[state].label}</span>${stale}`,
      state
    );
  }

  // ---------------------------------------------------------------------------
  // Page-specific analyses
  // ---------------------------------------------------------------------------

  function ownListingsRouteActive() {
    const hash = String(location.hash || "").toLowerCase();
    return /manage|mylist|my-list|yourlist|your-list|viewlisting|listings/.test(hash) && !/itemid=/.test(hash);
  }

  function panelToolbarHtml() {
    return `<div class="me-actions">
      <button class="me-btn me-open-listings" type="button" title="Compare your Item Market listings with the live floor (Limited key)">My listings</button>
      <button class="me-btn me-open-watchlist" type="button" title="Watched items and alert targets">Watchlist</button>
      <button class="me-btn me-open-portfolio" type="button" title="Value your whole inventory through the official API (Minimal key)">Portfolio</button>
      <button class="me-btn me-open-shops" type="button" title="City shop stock priced against the market">Shops</button>
      <button class="me-btn me-open-travel" type="button" title="Foreign shop prices ranked by profit per trip">Travel</button>
    </div>`;
  }

  function bindPanelToolbar() {
    ui.body?.querySelector(".me-open-listings")?.addEventListener("click", () => renderOwnListingsPanel());
    ui.body?.querySelector(".me-open-watchlist")?.addEventListener("click", () => renderWatchlistPanel());
    ui.body?.querySelector(".me-open-portfolio")?.addEventListener("click", () => renderPortfolioPanel());
    ui.body?.querySelector(".me-open-shops")?.addEventListener("click", () => renderShopRunsPanel());
    ui.body?.querySelector(".me-open-travel")?.addEventListener("click", () => renderTravelPlanPanel());
  }

  // Ended-auction timing section shared by the Item Market panels: when do
  // sales of this item close at the best prices (Torn City Time)?
  function auctionTimingHtml(sales, { stackableOnly = false } = {}) {
    const rows = stackableOnly ? (sales || []).filter((sale) => sale.stackable) : (sales || []);
    const timing = auctionTimingStats(rows);
    if (!timing.total) return "";
    const bucketRows = timing.buckets.map((bucket) => `<div class="me-diag-row${timing.best && bucket.key === timing.best.key ? " pass" : ""}">${escapeHtml(bucket.label)}: ${bucket.count ? `${formatMoney(bucket.median)} x${bucket.count}${Number.isFinite(bucket.ratio) ? ` (${bucket.ratio >= 1 ? "+" : ""}${((bucket.ratio - 1) * 100).toFixed(1)}%)` : ""}` : "no sales"}</div>`).join("");
    const summary = timing.best
      ? `Best window to end an auction: ${timing.best.label} (${timing.best.count} sales, ${((timing.best.ratio - 1) * 100).toFixed(1)}% above the overall median)${timing.worst && timing.worst.key !== timing.best.key ? `; cheapest wins closed ${timing.worst.label}` : ""}.`
      : `Not enough ended sales per window yet (${timing.total} in total).`;
    return `<details class="me-diag"><summary>Auction timing: ${timing.total} ended sales, median ${formatMoney(timing.overallMedian)}</summary><div class="me-diag-row">${escapeHtml(summary)}</div>${bucketRows}</details>`;
  }

  function itemMarketLink(itemId, name = "") {
    const encoded = encodeURIComponent(String(name || ""));
    return `https://www.torn.com/page.php?sid=ItemMarket#/market/view=sell&itemID=${asInt(itemId)}${name ? `&itemName=${encoded}` : ""}`;
  }

  function watchControlsHtml(snapshot, best) {
    const entry = Store.watchlist().find((row) => row.itemId === snapshot.itemId);
    if (entry) {
      return `<div class="me-actions"><span class="me-note">Watching: alert at or below ${formatMoney(entry.target)}</span><button class="me-btn me-unwatch" type="button">Stop watching</button></div>`;
    }
    const defaultTarget = best?.exit?.conservativeExitPrice
      ? Math.floor(best.exit.conservativeExitPrice * (1 - settings.minimumDiscount))
      : (snapshot.lowestPrice ? Math.floor(snapshot.lowestPrice * (1 - settings.minimumDiscount)) : 0);
    return `<div class="me-actions"><input class="me-inline-input me-watch-target" type="number" min="1" value="${defaultTarget || ""}" placeholder="Alert at or below $"><button class="me-btn me-watch" type="button">Watch</button></div>`;
  }

  function bindWatchControls(snapshot) {
    const body = ui.body;
    if (!body) return;
    body.querySelector(".me-watch")?.addEventListener("click", () => {
      const target = asInt(body.querySelector(".me-watch-target")?.value, 0);
      if (target <= 0) return;
      addWatchItem({ itemId: snapshot.itemId, name: snapshot.itemName, target });
      renderItemMarket();
    });
    body.querySelector(".me-unwatch")?.addEventListener("click", () => {
      Store.saveWatchlist(Store.watchlist().filter((row) => row.itemId !== snapshot.itemId));
      renderItemMarket();
    });
  }

  function equipmentRowsHtml(analysis) {
    const rows = analysis.rows.slice(0, 25);
    if (!rows.length) return "";
    return `<table class="me-table">
      <thead><tr><th>Group</th><th>Q</th><th>Price</th><th>Comps</th><th>AH sold</th><th>Disc.</th><th></th></tr></thead>
      <tbody>${rows.map((row) => `<tr class="${row.state}">
        <td title="${escapeHtml(row.groupLabel)}">${escapeHtml(row.groupLabel)}</td>
        <td>${Number.isFinite(row.quality) ? row.quality.toFixed(0) : "-"}</td>
        <td title="${formatMoney(row.price, true)}">${formatMoney(row.price)}</td>
        <td title="${row.comparableCount} comparable listings${row.qualityMatched ? " (quality matched)" : ""}">${row.comparableMedian ? `${formatMoney(row.comparableMedian)} x${row.comparableCount}` : "-"}</td>
        <td title="${row.salesCount} ended auctions in 30 days">${row.salesMedian ? `${formatMoney(row.salesMedian)} x${row.salesCount}` : "-"}</td>
        <td>${Number.isFinite(row.discount) ? `${(row.discount * 100).toFixed(1)}%` : "-"}</td>
        <td><span class="me-pill ${row.state}">${CLASS_META[row.state]?.label || row.state}</span></td>
      </tr>`).join("")}</tbody>
    </table>`;
  }

  async function renderEquipmentItemMarket(snapshot, historyStats) {
    const fresh = freshness(snapshot.cacheTimestamp);
    setPanel(`<div class="me-kicker">Item Market - equipment</div><div class="me-item-name">${escapeHtml(snapshot.itemName)}</div><div class="me-note">Loading ended Auction House sales for comparables...</div>`, fresh.label);
    const auctionSales = await loadAuctionSales(snapshot.itemId, { priority: 180 });
    if (detectSurface() !== "itemmarket" || getItemIdFromLocation() !== snapshot.itemId) return;
    const analysis = analyzeEquipmentListings(snapshot, { auctionSales, settings });
    const best = analysis.best;
    const summary = analysis.summary || {};
    const feeBps = itemMarketFeeBps(settings);
    const groupsHtml = analysis.groups.slice(0, 8).map((group) => `<div class="me-diag-row">${escapeHtml(group.label)}: ${group.count} listed from ${formatMoney(group.floor)} (median ${formatMoney(group.median)})${group.salesCount ? `; ${group.salesCount} AH sales, median ${formatMoney(group.salesMedian)}` : ""}</div>`).join("");

    setPanel(`
      <div class="me-kicker">Item Market - equipment comparables</div>
      <div class="me-item-name">${escapeHtml(snapshot.itemName)}</div>
      ${metricRows([
        ["Listings analyzed", `${analysis.rows.length}${snapshot.depthMetrics?.totalListings > analysis.rows.length ? ` of ${snapshot.depthMetrics.totalListings}` : ""}`],
        ["Plain floor", summary.plainFloor ? formatMoney(summary.plainFloor) : "-"],
        ["Plain median", summary.plainMedian ? formatMoney(summary.plainMedian) : "-"],
        ["Bonus/rarity floor", summary.bonusFloor ? formatMoney(summary.bonusFloor) : "-"],
        ["Torn daily average", snapshot.averagePrice ? formatMoney(snapshot.averagePrice) : "-"],
        ["AH sales (30d)", String(auctionSales.filter((sale) => sale.details).length)],
        ["API age", `${formatAge(fresh.ageSeconds)} - ${fresh.label}`]
      ])}
      <div class="me-rule"></div>
      <div class="me-kicker">Best value listing</div>
      ${best ? `<div class="me-callout ${best.state}">
        <div class="me-decision ${best.state}">${CLASS_META[best.state].icon} ${CLASS_META[best.state].label}</div>
        ${metricRows([
          ["Group", escapeHtml(best.groupLabel)],
          ["Quality", Number.isFinite(best.quality) ? best.quality.toFixed(1) : "-"],
          ["Price", formatMoney(best.price)],
          ["Reference", `${formatMoney(best.reference)} (${escapeHtml(best.referenceSource)})`],
          ["Discount", `${(best.discount * 100).toFixed(1)}%`],
          [`Net if resold (IM ${feeBps / 100}%)`, formatMoney(best.expectedNet), best.expectedNet >= 0 ? "me-good" : "me-bad"]
        ])}
      </div>` : `<div class="me-note">No listing is priced meaningfully below its comparable group.</div>`}
      ${equipmentRowsHtml(analysis)}
      ${groupsHtml ? `<details class="me-diag"><summary>Comparable groups</summary>${groupsHtml}</details>` : ""}
      ${auctionTimingHtml(auctionSales)}
      ${watchControlsHtml(snapshot, null)}
      ${panelToolbarHtml()}
      <div class="me-note">Equipment is grouped by rarity and bonus set, quality matched within 10 points when enough listings exist. Ended Auction House sales are the only official transaction evidence. Rare rolls trade on intangibles; treat this as a floor check, not a valuation.</div>
    `, fresh.label);
    bindWatchControls(snapshot);
    bindPanelToolbar();
  }

  async function renderItemMarket() {
    if (ownListingsRouteActive()) {
      await renderOwnListingsPanel();
      return;
    }
    const itemId = getItemIdFromLocation();
    if (!itemId) {
      setPanel(`<div class="me-kicker">Item Market</div><div class="me-note">Open a specific item to analyze its order book.${settings.browseOverlayEnabled !== false ? " Browse cards are compared with Torn's official market value as they appear." : ""}</div>${panelToolbarHtml()}`);
      bindPanelToolbar();
      if (settings.browseOverlayEnabled !== false) scanBrowseGrid({ force: false });
      return;
    }
    if (!Store.apiKey()) {
      errorPanel("Add a Torn API key to analyze this item.");
      return;
    }

    setPanel(`<div class="me-kicker">Item Market</div><div class="me-item-name">Loading item ${itemId}...</div>`, "API");
    try {
      const { snapshot, historyStats } = await loadSnapshot(itemId, { limit: API_DEEP_LIMIT, priority: 200 });
      if (!snapshot.supportedCommodity) {
        if (settings.equipmentEnabled !== false && snapshot.equipment) {
          await renderEquipmentItemMarket(snapshot, historyStats);
          return;
        }
        setPanel(`<div class="me-kicker">Item Market</div><div class="me-item-name">${escapeHtml(snapshot.itemName)}</div><div class="me-callout GREY"><div class="me-decision GREY">- NOT SUPPORTED</div><div class="me-note">Enable weapon/armor comparables in settings to analyze equipment listings.</div></div>`);
        return;
      }

      const liveRows = parseLiveItemMarketListings();
      let itemMeta = null;
      try {
        itemMeta = (await loadItemMetadataBatch([itemId], { priority: 190 })).get(itemId) || null;
      } catch (error) {
        log("Item metadata unavailable", error.message);
      }
      const museumContext = await loadMuseumContext([itemId], { priority: 190, metadata: new Map(itemMeta ? [[itemId, itemMeta]] : []) });
      const museum = museumContext.get(itemId) || null;
      const shopSell = shopSellFloor(itemMeta);
      // Ended auctions are the only official transaction evidence for
      // stackable items; one request, cached ten minutes.
      const auctionSales = settings.auctionEvidenceEnabled !== false ? await loadAuctionSales(itemId, { priority: 170 }) : [];
      const salesSummary = stackableSalesSummary(auctionSales);
      if (detectSurface() !== "itemmarket" || getItemIdFromLocation() !== itemId) return;

      // The official Torn API is the authoritative valuation source. The live
      // DOM is used only to confirm/highlight what the player currently sees.
      const evaluated = evaluatePrefixes(snapshot, historyStats, settings, Date.now(), { museum, shopSell: shopSell?.price, shopLabel: shopSell?.label });
      const best = evaluated.best;
      const compareCount = Math.max(2, best?.prefixCount || Math.min(5, snapshot.listings.length));
      const liveMatchesApi = liveRows.length >= compareCount && snapshot.listings.length >= compareCount &&
        Array.from({ length: compareCount }, (_, index) => (
          liveRows[index]?.price === snapshot.listings[index]?.price &&
          liveRows[index]?.quantity === snapshot.listings[index]?.quantity
        )).every(Boolean);
      const liveConfirmation = liveRows.length < 2
        ? "API"
        : (liveMatchesApi ? "PAGE MATCHES API" : "API - PAGE DIFFERS");
      const fresh = freshness(snapshot.cacheTimestamp);
      const reference = chooseReference(snapshot, historyStats);
      const learning = historyStats.oneDay.count < 5;
      const agreement = officialAgreement(snapshot);
      const currentDiscount = reference.value && snapshot.lowestPrice ? 1 - snapshot.lowestPrice / reference.value : null;
      const sourceWarning = liveRows.length >= 2 && !liveMatchesApi
        ? `<div class="me-note me-warn">The visible Torn listings differ from the current API cache. Market Edge is keeping the official API snapshot authoritative and will not mix the two books.</div>`
        : "";
      const feeBps = itemMarketFeeBps(settings);
      const feeLabel = `${feeBps / 100}%${feeBps > ITEM_MARKET_FEE_BPS ? " incl. anonymous" : ""}`;
      const fairValueCell = historyStats.historicalFairValue
        ? `<span title="${formatMoney(historyStats.historicalFairValue, true)}">${formatMoney(historyStats.historicalFairValue)}</span>`
        : (agreement.agrees
          ? `<span title="Torn daily average and current depth agree within ${(OFFICIAL_AGREEMENT_TOLERANCE * 100).toFixed(0)}%">${formatMoney(reference.value)} (official)</span>`
          : "Learning...");
      const coldStartNote = learning
        ? (agreement.agrees
          ? `<div class="me-note">Cold start: Torn's daily average (${formatMoney(snapshot.averagePrice)}) and the current depth anchor agree, so no warm-up penalty is applied. Local observations: ${historyStats.oneDay.count}/5.</div>`
          : `<div class="me-note me-learning">Learning market... ${historyStats.oneDay.count}/5 observations. ${agreement.available ? `Torn's daily average (${formatMoney(snapshot.averagePrice)}) differs ${(agreement.ratio * 100).toFixed(1)}% from the depth anchor, so` : "Without an official average,"} an extra 2% safety haircut applies.</div>`)
        : "";
      const museumRows = museum && museum.complete
        ? [[`${museum.label} implied value`, `<span title="${museum.points} points x ${formatMoney(museum.pointValue, true)} minus ${formatMoney(museum.othersCost, true)} for the other pieces">${formatMoney(museum.impliedValue)}</span>`, museum.impliedValue > (reference.value || 0) ? "me-good" : ""]]
        : [];
      const evidenceRows = [];
      if (salesSummary.count) {
        const agreesWithSales = reference.value ? Math.abs(salesSummary.median - reference.value) / reference.value : null;
        evidenceRows.push(["AH sold median (30d)", `<span title="${salesSummary.count} ended auctions, range ${formatMoney(salesSummary.low, true)} - ${formatMoney(salesSummary.high, true)}">${formatMoney(salesSummary.median)} x${salesSummary.count}</span>`, Number.isFinite(agreesWithSales) && agreesWithSales <= 0.10 ? "me-good" : ""]);
      }
      if (shopSell) evidenceRows.push([escapeHtml(shopSell.label), formatMoney(shopSell.price)]);

      setPanel(`
        <div class="me-kicker">Item Market - ${escapeHtml(liveConfirmation)}</div>
        <div class="me-item-name">${escapeHtml(snapshot.itemName)}</div>
        ${metricRows([
          ["Lowest", `<span title="${formatMoney(snapshot.lowestPrice, true)}">${formatMoney(snapshot.lowestPrice)}</span>`],
          ["Current anchor", `<span title="${formatMoney(snapshot.calculatedMarketAnchor, true)}">${formatMoney(snapshot.calculatedMarketAnchor)}</span>`],
          ["Torn daily average", snapshot.averagePrice ? `<span title="${formatMoney(snapshot.averagePrice, true)}">${formatMoney(snapshot.averagePrice)}</span>` : "-"],
          ["Fair value", fairValueCell, learning && !agreement.agrees ? "me-learning" : ""],
          ["Lowest discount", Number.isFinite(currentDiscount) ? `${(currentDiscount * 100).toFixed(2)}%` : "-"],
          ["24h MAD volatility", Number.isFinite(historyStats.oneDay.volatility) ? `${(historyStats.oneDay.volatility * 100).toFixed(2)}%` : "-"],
          ["API age", `${formatAge(fresh.ageSeconds)} - ${fresh.label}`],
          ["Observations (24h)", String(historyStats.oneDay.count)],
          ...museumRows,
          ...evidenceRows
        ])}
        ${sourceWarning}
        <div class="me-rule"></div>
        <div class="me-kicker">Best opportunity</div>
        ${best ? metricRows([
          ["Buy", `${best.quantityBought.toLocaleString("en-US")} units`],
          ["Average buy", `<span title="${formatMoney(best.averageBuyPrice, true)}">${formatMoney(best.averageBuyPrice)}</span>`],
          ["Capital", `<span title="${formatMoney(best.capitalRequired, true)}">${formatMoney(best.capitalRequired)}</span>`],
          ["Best exit", escapeHtml(best.routes.bestRoute)],
          ["Bazaar target", best.routes.bazaar ? formatMoney(best.routes.bazaar.suggestedPrice) : "Disabled"],
          ["Item Market target", formatMoney(best.routes.itemMarket.suggestedPrice)],
          [`IM net after ${feeLabel}`, formatMoney(Math.floor(best.routes.itemMarket.net / best.quantityBought))],
          ["Auction net after 3%", `<span title="Informational: auctions are never chosen as the best route">${formatMoney(Math.floor(best.routes.auction.net / best.quantityBought))}</span>`],
          ...(best.routes.museum ? [[`${best.routes.museum.label} target`, formatMoney(best.routes.museum.suggestedPrice)]] : []),
          ...(best.routes.shop ? [[escapeHtml(best.routes.shop.label), formatMoney(best.routes.shop.suggestedPrice)]] : [])
        ]) : `<div class="me-note">No affordable prefix with positive expected profit.</div>`}
        <div class="me-rule"></div>
        ${decisionHtml(best)}
        ${diagnosticsHtml(best)}
        ${coldStartNote}
        ${auctionTimingHtml(auctionSales, { stackableOnly: true })}
        ${watchControlsHtml(snapshot, best)}
        ${panelToolbarHtml()}
        <div class="me-note">Facts: official API asks, Torn daily average and the ${feeLabel} Item Market fee. The visible page is used only for confirmation/highlighting. Local data: observed anchors. Exit, profit and confidence are estimates - not guarantees.</div>
      `, fresh.label);
      bindWatchControls(snapshot);
      bindPanelToolbar();

      if (liveMatchesApi) highlightItemMarketRows(liveRows, best);
      else clearBadges();
    } catch (error) {
      errorPanel(describeApiError(error, { feature: "Item Market analysis" }));
    }
  }

  function highlightItemMarketRows(liveRows, best) {
    if (!liveRows.length) return;
    clearBadges();
    liveRows.forEach((row, index) => {
      const selected = best && index < best.prefixCount;
      const state = selected ? best.classification.state : "GREY";
      const text = selected ? `${CLASS_META[state].label} - ${best.roi >= 0 ? "+" : ""}${(best.roi * 100).toFixed(1)}%` : "PASS";
      addBadge(row.node, text, state, selected ? `Part of recommended ${best.quantityBought}-unit prefix; expected total profit ${formatMoney(best.expectedProfit, true)}.` : "Not part of the best current prefix.");
    });
  }

  function viewportPriority(visible, index = 0) {
    const rect = visible?.card?.getBoundingClientRect?.();
    if (!rect) return 100 - index;
    const viewportHeight = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
    const inViewport = rect.bottom >= 0 && rect.top <= viewportHeight;
    if (inViewport) return 1000 - Math.max(0, Math.round(rect.top / 10)) - index;
    if (rect.top > viewportHeight) return 500 - Math.min(300, Math.round((rect.top - viewportHeight) / 20)) - index;
    return 200 - index;
  }

  function resultForSurface(surface, visible, snapshot, historyStats, ownBazaar, renderMeta = {}, museum = null, extras = {}) {
    const shopSell = extras?.shopSell || null;
    const salesSummary = extras?.salesSummary || null;
    if (!snapshot?.supportedCommodity) {
      if (settings.equipmentEnabled !== false && snapshot?.equipment && snapshot.equipmentSummary) {
        // Buy-side surfaces get plain/bonus floors. Sell-side rows are priced
        // only from an expanded details panel (see promoteCopyPriceToRow).
        return { visible, snapshot, equipment: snapshot.equipmentSummary, renderMeta };
      }
      return { visible, snapshot, unsupported: true, renderMeta };
    }

    if (surface === "inventory") {
      const estimate = estimateInventoryExit({ quantity: visible.quantity, snapshot, historyStats, settings, museum, shopSell });
      if (!estimate && !(snapshot?.listings || []).length) return { visible, snapshot, historyStats, noListings: true, renderMeta };
      return { visible, snapshot, historyStats, inventory: estimate, renderMeta };
    }

    if (surface === "imsell") {
      // Item Market "add listing" form: the suggested Item Market price
      // (conservative exit minus undercut, through the item's pricing rule)
      // and the net per unit after the configured fee.
      const estimate = estimateInventoryExit({ quantity: visible.quantity, snapshot, historyStats, settings, museum, shopSell });
      if (!estimate) return { visible, snapshot, historyStats, sellForm: { target: null, reason: (snapshot?.listings || []).length ? "price unavailable" : "no listings" }, renderMeta };
      const floorSuggestion = snapshot.lowestPrice ? Math.max(1, snapshot.lowestPrice - Math.max(0, asInt(settings.itemMarketUndercut))) : null;
      const rule = Store.pricingRules()[visible.itemId] || null;
      const fill = applyPricingRule({ rule, floorSuggestion, anchorSuggestion: estimate.routes.itemMarket.suggestedPrice });
      const target = fill.price || estimate.routes.itemMarket.suggestedPrice;
      const feeBps = itemMarketFeeBps(settings);
      return { visible, snapshot, historyStats, sellForm: { target, net: grossToNet(target, feeBps), feeBps, floor: snapshot.lowestPrice, rule, estimate }, renderMeta };
    }

    if (surface === "auction") {
      const salesMedian = salesSummary?.median || null;
      const maxBid = maxRationalBid({ snapshot, historyStats, settings, quantity: visible.quantity, museum, shopSell, salesMedian });
      const headroom = Number.isFinite(maxBid) ? maxBid - visible.price : null;
      const direct = visible.price > 0
        ? evaluateDirectBuy({ buyPrice: visible.price, quantity: visible.quantity, snapshot, historyStats, settings, forceYellow: true, museum, shopSell })
        : null;
      return { visible, snapshot, historyStats, auction: { maxBid, headroom, direct, salesSummary }, renderMeta };
    }

    if (surface === "bazaar" && ownBazaar) {
      const estimate = estimateInventoryExit({ quantity: visible.quantity, snapshot, historyStats, settings, museum, shopSell });
      const target = estimate?.routes?.bazaar?.suggestedPrice;
      const delta = Number.isFinite(target) ? target - visible.price : null;
      // Repricing workbench: the floor-based suggestion (floor minus undercut,
      // Bazaar is fee-free so no discount) and the anchor-based target go
      // through the item's pricing rule.
      const floorSuggestion = snapshot.lowestPrice ? Math.max(1, snapshot.lowestPrice - Math.max(0, asInt(settings.itemMarketUndercut))) : null;
      const rule = Store.pricingRules()[visible.itemId] || null;
      const fill = applyPricingRule({ rule, floorSuggestion, anchorSuggestion: target });
      return { visible, snapshot, historyStats, ownBazaar: { target, delta, estimate, fill, rule, floor: snapshot.lowestPrice }, renderMeta };
    }

    let quantity = visible.quantity;
    if (surface === "travel" && settings.travelCapacity > 0) quantity = Math.min(quantity, settings.travelCapacity);
    if (surface === "travel" && settings.travelCapacity === 0) quantity = 1;
    if (surface === "cityshop") quantity = Math.max(1, asInt(settings.shopRunQuantity, 100));
    const direct = evaluateDirectBuy({
      buyPrice: visible.price,
      quantity,
      snapshot,
      historyStats,
      settings,
      forceYellow: surface === "auction",
      museum,
      shopSell
    });
    return {
      visible,
      snapshot,
      historyStats,
      direct,
      quantityUsed: quantity,
      perItemOnly: surface === "travel" && settings.travelCapacity === 0,
      renderMeta
    };
  }

  let listQueueGeneration = 0;
  let activeListQueueGroup = "";

  function beginListQueueGroup(surface, { cancelObsolete = false } = {}) {
    const prefix = `list:${surface}:`;
    if (cancelObsolete || !activeListQueueGroup.startsWith(prefix)) {
      activeListQueueGroup = `${prefix}${++listQueueGeneration}`;
      api.scheduler.cancelQueued(
        (job) => String(job.meta?.queueGroup || "").startsWith("list:") && job.meta.queueGroup !== activeListQueueGroup,
        "Market Edge list request superseded by a newer Torn view."
      );
    }
    return activeListQueueGroup;
  }

  function cancelQueuedListRequests(reason = "Market Edge left the list view.") {
    activeListQueueGroup = "";
    return api.scheduler.cancelQueued(
      (job) => String(job.meta?.queueGroup || "").startsWith("list:"),
      reason
    );
  }

  function genericIntro(surface, { clear = true } = {}) {
    removeFloatingUi();
    if (clear) clearInlineAnalysis();
    // List-style surfaces use War-Overlay-style inline intelligence rather
    // than a floating results window. New rows are discovered incrementally.
    setTimeout(() => scanVisibleSurface(surface, { retryIfEmpty: true, force: false, cancelObsolete: true }), 250);
  }

  // One scan at a time per page. A scan requested while another is running
  // is coalesced into a single follow-up pass, so mutation storms cannot
  // stack overlapping scans (duplicate overlays, wasted requests).
  const scanState = { running: false, pending: null };

  async function scanVisibleSurface(surface, options = {}) {
    if (scanState.running) {
      const previous = scanState.pending || {};
      scanState.pending = { surface, options: { ...previous.options, ...options, force: Boolean(previous.options?.force || options.force) } };
      return;
    }
    scanState.running = true;
    try {
      await scanVisibleSurfaceNow(surface, options);
    } catch (error) {
      log("Scan failed", surface, error?.message || error);
    } finally {
      scanState.running = false;
      const pending = scanState.pending;
      scanState.pending = null;
      if (pending && document.visibilityState === "visible" && detectSurface() === pending.surface) {
        setTimeout(() => scanVisibleSurface(pending.surface, pending.options), 60);
      }
    }
  }

  async function scanVisibleSurfaceNow(surface, { retryIfEmpty = false, force = false, cancelObsolete = false } = {}) {
    removeFloatingUi();
    if (document.visibilityState !== "visible") return;

    const queueGroup = beginListQueueGroup(surface, { cancelObsolete });
    const ownBazaar = surface === "bazaar" ? await isOwnBazaar() : false;
    if (detectSurface() !== surface || document.visibilityState !== "visible") return;

    const requireMoney = !["inventory", "imsell"].includes(surface);
    let items = surface === "auction"
      ? collectAuctionItems()
      : (surface === "imsell" ? collectSellFormRows() : (surface === "bazaar" && ownBazaar ? collectOwnBazaarItems() : collectVisibleItems({ requireMoney })));

    if (!items.length) {
      if (retryIfEmpty) {
        setTimeout(() => {
          if (detectSurface() === surface && document.visibilityState === "visible") {
            scanVisibleSurface(surface, { retryIfEmpty: false, force, cancelObsolete: false });
          }
        }, 650);
      }
      await scanExpandedEquipment(surface, ownBazaar);
      return;
    }

    items = items.filter((visible) => {
      if (!visible?.card?.isConnected) return false;
      const existing = visible.card.querySelector?.(`.me-inline-analysis[data-me-item-id="${visible.itemId}"]`);
      const scanningGroup = visible.card.dataset?.meScanningGroup || "";
      const scanning = visible.card.dataset?.meScanning === String(visible.itemId) && scanningGroup === queueGroup;
      if (cancelObsolete && scanningGroup && scanningGroup !== queueGroup) {
        delete visible.card.dataset.meScanning;
        delete visible.card.dataset.meScanningGroup;
        if (existing?.classList.contains("me-loading")) existing.remove();
      }
      if (force && existing) existing.remove();
      return force || (!scanning && existing?.dataset?.meComplete !== "1");
    });
    if (!items.length) {
      // Every row is already annotated; an expanded details panel may still
      // be new (opening one does not change the rows).
      await scanExpandedEquipment(surface, ownBazaar);
      return;
    }

    if (!Store.apiKey()) {
      items.forEach((visible) => renderInlineError(visible, "Add API key in Market Edge settings"));
      return;
    }

    items.sort((a, b) => viewportPriority(b) - viewportPriority(a));
    items.forEach((visible) => {
      if (visible.card?.dataset) {
        visible.card.dataset.meScanning = String(visible.itemId);
        visible.card.dataset.meScanningGroup = queueGroup;
      }
      renderInlineLoading(visible);
    });

    let metadata = new Map();
    try {
