// Reference only. Not compiled, not deployed, not bundled (tsconfig includes
// only src/, eslint touches only ts/tsx).
//
// Proven script that published real Mobile.bg listings. Kept because its form
// steps were taken from the live site instead of assumed.
//
// Techniques worth adopting in services/mobile-publisher:
//   * wait for dependent lists (model after make, country after location) up to
//     10s, instead of a fixed sleep;
//   * stop the whole listing on a missing field with a clear error, instead of
//     silently skipping it;
//   * submit step 1 programmatically through actions=2;
//   * confirm with the exact text "Преглед на обявата";
//   * open the public listing and count really loaded photos.
//
// Do NOT wire this in as-is. It reads jobs from a local JSON file and uploads
// photos through an external browser gateway (V4_GATEWAY_URL, V4_RUN_TOKEN),
// which bypasses Supabase entirely. Our data lives in the database and the live
// screen needs the run state there.
//
// Reconstructed from the conversation on 2026-09-17 after the original
// /home/openhands/workspace/project/ directory disappeared. Note: it sets the
// month to "януари"; our requirement is April.

import { readFile, writeFile } from "fs/promises"

const root = "/mnt/workspace/c81da85b-0830-46eb-a8fc-df0310e7174d"
const jobsPath = `${root}/.bcode/agent-workspace/autoimport-v19-publish-jobs.json`
const progressPath = `${root}/.bcode/agent-workspace/mobilebg-direct-v19-progress.json`
const formUrl = "https://www.mobile.bg/pcgi/mobile.cgi?pubtype=1&act=6&subact=4&actions=1"
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function evaluate(session, expression) {
  const result = await session.Runtime.evaluate({ expression, returnByValue: true, awaitPromise: true })
  return result.result?.value
}

async function setValue(session, name, value, kind = "input") {
  const proto = kind === "select" ? "HTMLSelectElement" : kind === "textarea" ? "HTMLTextAreaElement" : "HTMLInputElement"
  return evaluate(session, `(() => {
    const e = document.forms.namedItem("pub")?.elements[${JSON.stringify(name)}]
    if (!e) return false
    Object.getOwnPropertyDescriptor(${proto}.prototype, "value").set.call(e, String(${JSON.stringify(value)}))
    e.dispatchEvent(new Event("input", { bubbles: true }))
    e.dispatchEvent(new Event("change", { bubbles: true }))
    return true
  })()`)
}

async function selectText(session, name, text) {
  return evaluate(session, `(() => {
    const e = document.forms.namedItem("pub")?.elements[${JSON.stringify(name)}]
    if (!e) return { ok: false, error: "field_missing" }
    const wanted = String(${JSON.stringify(text)}).trim().toLowerCase()
    const option = [...e.options].find((o) => o.text.trim().toLowerCase() === wanted)
    if (!option) return { ok: false, error: "option_missing", options: [...e.options].map((o) => o.text.trim()) }
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(e, option.value)
    e.dispatchEvent(new Event("change", { bubbles: true }))
    return { ok: true, value: option.value }
  })()`)
}

async function resetPage(session) {
  const loaded = session.waitFor("Page.loadEventFired", { timeoutMs: 15000 })
  loaded.catch(() => {})
  await session.Page.navigate({ url: formUrl })
  await Promise.race([loaded, sleep(7000)])
  await sleep(500)
}

async function verifyPublicPhotos(session, url, expected) {
  const loaded = session.waitFor("Page.loadEventFired", { timeoutMs: 15000 })
  loaded.catch(() => {})
  await session.Page.navigate({ url })
  await Promise.race([loaded, sleep(10000)])
  await sleep(500)
  return evaluate(session, `(() => {
    const photoLines = [...document.body.innerText.matchAll(/\\b(\\d+)\\s*\\/\\s*(\\d+)\\b/g)].map((m) => ({ visible: Number(m[1]), total: Number(m[2]) }))
    const sourceImages = [...document.querySelectorAll("img.carouselimg")]
      .map((image) => image.dataset.src || image.currentSrc || image.src)
      .filter((source) => source && !source.includes("nophoto"))
    const uniqueSourceImages = [...new Set(sourceImages)]
    const realLoadedImages = [...document.images].filter((image) => {
      const source = image.currentSrc || image.src
      return source && !source.includes("nophoto") && image.naturalWidth > 0 && image.naturalHeight > 0
    }).length
    const maxPhotoTotal = Math.max(0, ...photoLines.map((line) => line.total))
    return {
      url: location.href,
      photoLines,
      sourceImageCount: uniqueSourceImages.length,
      realLoadedImages,
      maxPhotoTotal,
      expected: Number(${JSON.stringify(expected)}),
      ok: uniqueSourceImages.length >= 1 && realLoadedImages >= 1 && maxPhotoTotal >= Number(${JSON.stringify(expected)})
    }
  })()`)
}

async function stageImages(item) {
  const staged = []
  const skipped = []
  for (let start = 0; start < item.source_images.length; start += 10) {
    const form = new FormData()
    for (let i = start; i < Math.min(start + 10, item.source_images.length); i++) {
      const response = await fetch(item.source_images[i])
      if (!response.ok) {
        if (response.status === 404) {
          skipped.push({ index: i, status: response.status, url: item.source_images[i] })
          continue
        }
        throw new Error(`image_http_${response.status}`)
      }
      const bytes = await response.arrayBuffer()
      form.append("files", new File([bytes], `${String(i + 1).padStart(2, "0")}.jpg`, { type: "image/jpeg" }))
    }
    if (!form.has("files")) continue
    const response = await fetch(`${process.env.V4_GATEWAY_URL}/api/v4/internal/runs/${process.env.V4_RUN_ID}/browser/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.V4_RUN_TOKEN}` },
      body: form,
    })
    const data = await response.json()
    if (!response.ok) throw new Error(JSON.stringify(data))
    staged.push(...data.staged.map((file) => file.browser.path))
  }
  return { paths: staged, skipped }
}

const fuelText = { petrol: "Бензинов", diesel: "Дизелов", electric: "Електрически", hybrid: "Хибриден" }
const transmissionText = { automatic: "Автоматична", manual: "Ръчна", "semi-automatic": "Полуавтоматична" }
const bodyText = { van: "Ван", large_suv: "Джип", small_suv: "Джип", pickup: "Пикап", coupe: "Купе", convertible: "Кабрио", wagon: "Комби", hatchback: "Хечбек", sedan: "Седан", other: "Други" }
const colorText = { white: "Бял", black: "Черен", grey: "Сив", silver: "Сребърен", blue: "Син", red: "Червен", brown: "Кафяв", green: "Зелен", orange: "Оранжев", beige: "Бежов", gold: "Златист" }

export async function publishOne(session, item) {
  const result = { row: item.row, make: item.make, model: item.model, year: item.year, price_eur: item.price_eur, canada_final_eur: item.canada_final_eur, bulgaria_lowest_eur: item.bulgaria_lowest_eur }
  try {
    const makeText = { RAM: "Dodge", Volkswagen: "VW" }[item.make] || item.make
    const modelText = item.make === "RAM" && item.model === "1500" ? "RAM 1500" : item.make === "MINI" && item.model === "Cooper Countryman" ? "Countryman" : item.make === "MINI" && item.model === "Cooper Clubman" ? "Clubman" : item.make === "MINI" && item.model === "3 Door" ? "Cooper s" : item.make === "Nissan" && (item.model === "Titan" || item.model === "Titan XD") ? "Titan crew cab" : item.make === "GMC" && (item.model.startsWith("Sierra") || item.model === "1500") ? "Sierra" : item.make === "Ford" && item.model === "F 150" ? "F150" : item.make === "Toyota" && item.model === "RAV 4" ? "Rav4" : item.make === "Chevrolet" && item.model === "Unspecified" ? "Blazer" : item.make === "Chevrolet" && item.model.startsWith("Silverado") ? "Silverado" : item.model
    const bodyLabel = item.body !== "other" ? bodyText[item.body] : item.make === "Mercedes-Benz" ? "Седан" : item.make === "Dodge" || item.make === "RAM" ? "Пикап" : "Джип"
    await resetPage(session)
    if (!(await selectText(session, "f5", makeText)).ok) throw new Error(`make_option_missing:${makeText}`)
    for (let i = 0; i < 40; i++) {
      if (Number(await evaluate(session, 'document.forms.namedItem("pub").elements.f6.options.length')) > 1) break
      await sleep(250)
    }
    const model = await selectText(session, "f6", modelText)
    if (!model?.ok) throw new Error(`model:${JSON.stringify(model)}`)
    const fields = [
      ["f8", fuelText[item.fuel], "select"], ["f25", "Употребяван", "select"], ["f9", item.horsepower || "", "input"],
      ["f12", item.price_eur, "input"], ["f13", "EUR", "select"], ["f10", transmissionText[item.transmission], "select"],
      ["f11", bodyLabel, "select"], ["f31", "Цената е с включено ДДС", "select"], ["f16", item.mileage, "input"],
      ["f14", "януари", "select"], ["f15", item.year, "select"], ["f17", colorText[item.color], "select"], ["f18", "Извън страната", "select"],
    ]
    for (const [name, value, kind] of fields) {
      const ok = kind === "select" ? (await selectText(session, name, value)).ok : await setValue(session, name, value, kind)
      if (!ok) throw new Error(`field_missing_or_invalid:${name}`)
    }
    for (let i = 0; i < 40; i++) {
      if (Number(await evaluate(session, 'document.forms.namedItem("pub").elements.f19?.options.length')) > 1) break
      await sleep(250)
    }
    if (!(await selectText(session, "f19", "Канада")).ok) throw new Error("country_missing")
    if (!(await setValue(session, "f21", item.description ?? "!!!реална крайна цена!!!", "textarea"))) throw new Error("field_missing:f21")
    if (!(await setValue(session, "f22", "0887353653", "input"))) throw new Error("field_missing:f22")
    const form = await evaluate(session, `(() => {
      const f = document.forms.namedItem("pub")
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(f.elements.actions, "2")
      HTMLFormElement.prototype.submit.call(f)
      return true
    })()`)
    if (!form) throw new Error("step1_submit_failed")
    let step2 = false
    for (let i = 0; i < 30; i++) {
      step2 = Boolean(await evaluate(session, 'document.querySelector(\'input[type="file"]\') && /Стъпка 2|Добавяне на снимки/.test(document.body.innerText)'))
      if (step2) break
      await sleep(500)
    }
    if (!step2) throw new Error("step2_not_reached")
    const staged = await stageImages(item)
    const paths = staged.paths
    if (!paths.length) throw new Error("no_usable_images")
    await session.DOM.enable()
    const documentNode = await session.DOM.getDocument({ depth: -1, pierce: true })
    const input = await session.DOM.querySelector({ nodeId: documentNode.root.nodeId, selector: 'input[type="file"]' })
    if (!input.nodeId) throw new Error("file_input_missing")
    await session.DOM.setFileInputFiles({ nodeId: input.nodeId, files: paths })
    let attached = 0
    for (let i = 0; i < 180; i++) {
      attached = Number(await evaluate(session, 'document.querySelectorAll("li.hasPhoto .photo[style*=\"background-image\"]").length')) || 0
      const processing = Number(await evaluate(session, 'document.querySelectorAll("li.hasPhoto .processing").length')) || 0
      if (attached >= paths.length && processing === 0) break
      await sleep(500)
    }
    result.attached = attached
    result.expected = paths.length
    if (attached < paths.length) throw new Error(`${attached}/${paths.length} photos attached before final step`)
    await evaluate(session, `(() => { const e = [...document.querySelectorAll("a,button")].find((e) => (e.innerText || e.value || "").trim() === "ПРОДЪЛЖИ"); if (!e) return false; e.click(); return true })()`)
    await sleep(7000)
    const listing = await evaluate(session, `(() => { const e = [...document.querySelectorAll("a")].find((e) => (e.innerText || "").trim() === "Преглед на обявата"); return { url: e?.href || null, body: document.body.innerText.slice(-1200) } })()`)
    if (!listing?.url) throw new Error("no_public_listing_link")
    result.listing_url = listing.url
    result.public_photo_check = await verifyPublicPhotos(session, listing.url, paths.length)
    result.state = result.public_photo_check?.ok ? "published" : "published_no_photos"
  } catch (error) {
    result.state = "failed"
    result.message = String(error)
  }
  return result
}

export async function runBatch(session, limit = 3) {
  const jobs = JSON.parse(await readFile(jobsPath, "utf8")).jobs
  let progress
  try { progress = JSON.parse(await readFile(progressPath, "utf8")) } catch { progress = { results: [] } }
  const processed = new Set(progress.results.filter((item) => item.listing_url && ["published", "published_no_photos"].includes(item.state)).map((item) => item.row))
  const pending = jobs.filter((item) => !processed.has(item.row)).slice(0, limit)
  for (const item of pending) {
    const result = await publishOne(session, item)
    progress.results.push(result)
    await writeFile(progressPath, JSON.stringify(progress, null, 2))
    console.log(JSON.stringify(result))
  }
  return { processed: pending.length, totalResults: progress.results.length, published: progress.results.filter((item) => item.state === "published").length }
}
