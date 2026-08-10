/**
 * AR yerleştirme motoru (2.5D).
 *
 * Ürünü, telefonun kamera görüntüsü üzerine GERÇEK ÖLÇEĞİNDE yerleştirir.
 * Ölçekleme keyfi değil: katalogdaki mm cinsinden ölçüler + delik iğne
 * (pinhole) kamera modeli kullanılır.
 *
 *   Kamera yerde h metre yükseklikte, θ kadar aşağı eğik.
 *   Zeminde, kameradan Zh metre ileride ve X metre yanda bir nokta için:
 *
 *     y_c = -h·cosθ + Zh·sinθ        z_c = h·sinθ + Zh·cosθ
 *     ekranX = W/2 + f·X/z_c         ekranY = H/2 - f·y_c/z_c
 *     pikselBölüMetre = f / z_c      f = (H/2) / tan(dikeyGörüşAçısı/2)
 *
 * Ürün dünyada (mesafe, azimut) kutupsal koordinatıyla saklanır. Telefon
 * döndükçe cihaz yönelim sensöründen gelen yaw/pitch ile ekran konumu
 * yeniden hesaplanır — böylece ürün odada SABİT durur, ekranda değil.
 *
 * Bu 3 serbestlik dereceli (3DoF) bir sabitlemedir: kullanıcı telefonu
 * çevirdiğinde ürün yerinde kalır, ama odada yürüdüğünde takip edemez.
 * Tam takip (6DoF) ve gerçek nesne arkasına gizlenme (occlusion) ARKit /
 * ARCore ister — paketin 2. aşaması.
 */

const DER = Math.PI / 180

export class ArSahne {
  constructor({ tuval, video, fonGorsel }) {
    this.tuval = tuval
    this.ctx = tuval.getContext('2d')
    this.video = video
    this.fonGorsel = fonGorsel

    this.kamera = {
      yukseklikM: 1.35, // kullanıcının telefonu tuttuğu yükseklik
      // Sensör yoksa kullanılan varsayılan eğim. İnsanlar ürünü odaya
      // yerleştirirken telefonu belirgin şekilde aşağı tutar; 12° gibi küçük
      // bir değer zemini çok uzağa attığı için ürün "havada" duruyordu.
      pitch: 24 * DER,
      yaw: 0,
      fovDikey: 62 * DER,
    }

    // Ürünün üzerine konduğu yüzeyin yerden yüksekliği (m).
    // Koltuk/masa için 0 (zemin), vazo gibi dekoratif ürünler için ~0.75 (masa üstü).
    this.yuzeyM = 0

    this.capa = { mesafe: 2.6, azimut: 0 }
    this.urun = null
    this.aynala = false
    this.olcuModu = false
    this.dunyayaSabit = false

    this._sabitYaw = 0 // sabitleme kapalıyken kullanılan referans yön
    this._suruklemeOfseti = null
    this._isaretciler = new Map()
    this._pinchBaslangic = null
    this._calisiyor = false

    this._boyutlandir()
    addEventListener('resize', () => this._boyutlandir())
    this._olaylariBagla()
  }

  // ---------------------------------------------------------------- kurulum

  _boyutlandir() {
    const dpr = Math.min(devicePixelRatio || 1, 2)
    const r = this.tuval.getBoundingClientRect()
    this.G = r.width
    this.Y = r.height
    this.tuval.width = Math.round(r.width * dpr)
    this.tuval.height = Math.round(r.height * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  get odak() {
    return this.Y / 2 / Math.tan(this.kamera.fovDikey / 2)
  }

  /** Kameranın, ürünün durduğu YÜZEYDEN yüksekliği. */
  _h() {
    return Math.max(0.2, this.kamera.yukseklikM - this.yuzeyM)
  }

  urunAyarla(urun, kesim, yuzeyM = 0) {
    this.urun = {
      ...urun,
      kesim,
      genislikM: urun.genislikMm / 1000,
      yukseklikM: urun.yukseklikMm / 1000,
      derinlikM: urun.derinlikMm / 1000,
    }
    this.yuzeyM = yuzeyM
    this.aynala = false
    this.ilkCercevele()
  }

  /**
   * Ürünü ekranda makul bir büyüklükte gösterecek başlangıç mesafesini seçer.
   *
   * Ölçek burada bozulmuyor: sadece ürünün ilk bırakıldığı nokta seçiliyor —
   * gerçek AR uygulamalarında nişangahın gösterdiği yere bırakmakla aynı şey.
   * Kullanıcı sürükledikçe mesafe değişir ve boyut perspektife göre güncellenir.
   */
  ilkCercevele() {
    if (!this.urun || !this.G) return
    const f = this.odak
    const h = this._h()
    const { pitch } = this.kamera

    // 1) Ürünün tabanı ekranın alt bölgesine gelsin — zemine oturmuş görünsün
    const taban = this.ekrandanDunyaya(this.G / 2, this.Y * 0.72)
    const ZhTaban = taban ? taban.mesafe : 3
    const zcTaban = h * Math.sin(pitch) + ZhTaban * Math.cos(pitch)

    // 2) Sadece taşma çok belirginse geri it.
    //    Sıkı bir "ekrana sığsın" kuralı ürünü gereksiz uzağa atıyor ve
    //    zeminden koparıp havada duruyormuş gibi gösteriyordu. Geniş bir
    //    koltuğun yakın mesafede kadrajı doldurması gerçekçi olandır.
    const zcSigma = Math.max(
      (f * this.urun.genislikM) / (1.0 * this.G),
      (f * this.urun.yukseklikM) / (0.72 * this.Y)
    )

    const zc = Math.max(zcTaban, zcSigma)
    const Zh = (zc - h * Math.sin(pitch)) / Math.cos(pitch)
    this.capa = { mesafe: Math.min(12, Math.max(0.4, Zh)), azimut: this._yaw() }
  }

  /** Ekran açıldığında çağrılmalı: gizliyken ölçülen tuval 0×0 kalır. */
  tazeleBoyut() {
    this._boyutlandir()
  }

  baslat() {
    this._boyutlandir()
    if (this._calisiyor) return
    this._calisiyor = true
    const dongu = () => {
      if (!this._calisiyor) return
      this.ciz()
      requestAnimationFrame(dongu)
    }
    requestAnimationFrame(dongu)
  }

  durdur() {
    this._calisiyor = false
  }

  // ------------------------------------------------------------- projeksiyon

  /**
   * Hesaplarda kullanılan kamera yönü.
   *
   * Dünyaya sabitliyken cihazın gerçek yönü kullanılır. Sabitleme kapalıyken
   * SABİT bir referans kullanılmalı — burada ürünün kendi azimutunu döndürmek
   * bagil açıyı her zaman sıfırlıyor, yani ürün ekranın tam ortasına
   * çivileniyor ve yana taşınamıyordu.
   */
  _yaw() {
    return this.dunyayaSabit ? this.kamera.yaw : this._sabitYaw
  }

  /** Sabitlemeyi açıp kapatırken ürünün göründüğü yer değişmesin. */
  sabitlemeyiAyarla(acik) {
    if (acik === this.dunyayaSabit) return
    const bagil = this.capa.azimut - this._yaw()
    this.dunyayaSabit = acik
    if (!acik) this._sabitYaw = this.kamera.yaw
    this.capa.azimut = this._yaw() + bagil
  }

  /** Dünya kutupsal (mesafe, azimut) → ekran noktası + ölçek. */
  dunyadanEkrana(mesafe, azimut) {
    const { pitch } = this.kamera
    const h = this._h()
    const bagil = azimut - this._yaw()
    const X = mesafe * Math.sin(bagil)
    const Zh = mesafe * Math.cos(bagil)

    const yc = -h * Math.cos(pitch) + Zh * Math.sin(pitch)
    const zc = h * Math.sin(pitch) + Zh * Math.cos(pitch)
    if (zc < 0.15) return null // kameranın arkasında

    const f = this.odak
    return {
      x: this.G / 2 + (f * X) / zc,
      y: this.Y / 2 - (f * yc) / zc,
      ppm: f / zc, // piksel / metre
      zc,
    }
  }

  /** Ekran noktası → zemindeki dünya kutupsal koordinatı. */
  ekrandanDunyaya(ex, ey) {
    const { pitch } = this.kamera
    const h = this._h()
    const f = this.odak
    const u = (this.Y / 2 - ey) / f

    const payda = Math.sin(pitch) - u * Math.cos(pitch)
    if (payda <= 0.02) return null // ufuk çizgisinin üstü — zemin yok

    const Zh = (h * (u * Math.sin(pitch) + Math.cos(pitch))) / payda
    if (!isFinite(Zh) || Zh <= 0) return null

    const zc = h * Math.sin(pitch) + Zh * Math.cos(pitch)
    const X = ((ex - this.G / 2) * zc) / f

    return {
      mesafe: Math.hypot(X, Zh),
      azimut: this._yaw() + Math.atan2(X, Zh),
    }
  }

  // ------------------------------------------------------------------- çizim

  ciz() {
    const ctx = this.ctx
    ctx.clearRect(0, 0, this.G, this.Y)
    if (!this.urun) return

    const nokta = this.dunyadanEkrana(this.capa.mesafe, this.capa.azimut)
    if (!nokta) return

    // Ürün kutusu doğrudan katalog ölçüsünden çiziliyor: fotoğrafın en/boy
    // oranı değil, gerçek en ve yükseklik belirleyici. "Gerçek ölçü" iddiasının
    // karşılığı bu satır.
    const { x, y, ppm } = nokta
    const enPx = this.urun.genislikM * ppm
    const boyPx = this.urun.yukseklikM * ppm

    if (this.olcuModu) this._zeminIzgarasiCiz(ctx)
    this._golgeCiz(ctx, x, y, enPx)

    ctx.save()
    ctx.translate(x, y)
    if (this.aynala) ctx.scale(-1, 1)
    ctx.drawImage(this.urun.kesim.canvas, -enPx / 2, -boyPx, enPx, boyPx)
    ctx.restore()

    if (this.olcuModu) this._olculeriCiz(ctx, x, y, enPx, boyPx)

    this._sonKare = { x, y, enPx, boyPx }
  }

  _golgeCiz(ctx, x, y, enPx) {
    // Zemine temas gölgesi. Perspektif nedeniyle uzakta basıklaşır.
    const rx = enPx * 0.55
    const ry = Math.max(3, rx * 0.20 * Math.cos(this.kamera.pitch))
    const g = ctx.createRadialGradient(x, y, 0, x, y, rx)
    g.addColorStop(0, 'rgba(0,0,0,0.38)')
    g.addColorStop(0.55, 'rgba(0,0,0,0.16)')
    g.addColorStop(1, 'rgba(0,0,0,0)')

    ctx.save()
    ctx.translate(x, y)
    ctx.scale(1, ry / rx)
    ctx.translate(-x, -y)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, rx, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  _zeminIzgarasiCiz(ctx) {
    // Zemin düzleminin doğru anlaşıldığını gösteren 50 cm'lik ızgara.
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'
    ctx.lineWidth = 1

    const merkez = this.capa
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath()
      let ilk = true
      for (let t = -3; t <= 3; t += 0.25) {
        const X = i * 0.5
        const Zh = merkez.mesafe + t * 0.5
        const n = this.dunyadanEkrana(Math.hypot(X, Zh), merkez.azimut + Math.atan2(X, Zh))
        if (!n) { ilk = true; continue }
        ilk ? ctx.moveTo(n.x, n.y) : ctx.lineTo(n.x, n.y)
        ilk = false
      }
      ctx.stroke()

      ctx.beginPath()
      ilk = true
      for (let t = -3; t <= 3; t += 0.25) {
        const X = t * 0.5
        const Zh = merkez.mesafe + i * 0.5
        const n = this.dunyadanEkrana(Math.hypot(X, Zh), merkez.azimut + Math.atan2(X, Zh))
        if (!n) { ilk = true; continue }
        ilk ? ctx.moveTo(n.x, n.y) : ctx.lineTo(n.x, n.y)
        ilk = false
      }
      ctx.stroke()
    }
    ctx.restore()
  }

  _olculeriCiz(ctx, x, y, enPx, boyPx) {
    const cm = (mm) => `${Math.round(mm / 10)} cm`
    ctx.save()
    ctx.strokeStyle = '#ffffff'
    ctx.fillStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = 4

    const okCiz = (x1, y1, x2, y2) => {
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      const a = Math.atan2(y2 - y1, x2 - x1)
      for (const [px, py, yon] of [[x1, y1, a], [x2, y2, a + Math.PI]]) {
        ctx.beginPath()
        ctx.moveTo(px, py)
        ctx.lineTo(px + 8 * Math.cos(yon - 0.4), py + 8 * Math.sin(yon - 0.4))
        ctx.lineTo(px + 8 * Math.cos(yon + 0.4), py + 8 * Math.sin(yon + 0.4))
        ctx.closePath()
        ctx.fill()
      }
    }

    const etiket = (metin, ex, ey) => {
      const g = ctx.measureText(metin).width + 12
      ctx.shadowBlur = 0
      ctx.fillStyle = 'rgba(0,0,0,0.72)'
      ctx.beginPath()
      ctx.roundRect(ex - g / 2, ey - 11, g, 22, 11)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.fillText(metin, ex, ey)
      ctx.shadowBlur = 4
    }

    // Genişlik
    okCiz(x - enPx / 2, y + 18, x + enPx / 2, y + 18)
    etiket(cm(this.urun.genislikMm), x, y + 18)

    // Yükseklik
    const sol = x - enPx / 2 - 16
    okCiz(sol, y, sol, y - boyPx)
    etiket(cm(this.urun.yukseklikMm), sol, y - boyPx / 2)

    ctx.restore()
  }

  // -------------------------------------------------------------- etkileşim

  _olaylariBagla() {
    const el = this.tuval

    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId)
      this._isaretciler.set(e.pointerId, { x: e.offsetX, y: e.offsetY })

      if (this._isaretciler.size === 1 && this._sonKare) {
        const { x, y } = this._sonKare
        this._suruklemeOfseti = { dx: e.offsetX - x, dy: e.offsetY - y }
      }
      if (this._isaretciler.size === 2) {
        this._pinchBaslangic = { uzaklik: this._pinchUzakligi(), mesafe: this.capa.mesafe }
      }
    })

    el.addEventListener('pointermove', (e) => {
      if (!this._isaretciler.has(e.pointerId)) return
      this._isaretciler.set(e.pointerId, { x: e.offsetX, y: e.offsetY })

      if (this._isaretciler.size === 2 && this._pinchBaslangic) {
        const oran = this._pinchUzakligi() / this._pinchBaslangic.uzaklik
        // Parmakları açmak ürünü yaklaştırır (büyütür)
        this.capa.mesafe = Math.min(12, Math.max(0.6, this._pinchBaslangic.mesafe / oran))
        return
      }

      if (this._isaretciler.size === 1 && this._suruklemeOfseti) {
        const hedef = this.ekrandanDunyaya(
          e.offsetX - this._suruklemeOfseti.dx,
          e.offsetY - this._suruklemeOfseti.dy
        )
        if (hedef) this.capa = hedef
      }
    })

    const birak = (e) => {
      this._isaretciler.delete(e.pointerId)
      if (this._isaretciler.size < 2) this._pinchBaslangic = null
      if (this._isaretciler.size === 0) this._suruklemeOfseti = null
    }
    el.addEventListener('pointerup', birak)
    el.addEventListener('pointercancel', birak)

    // Masaüstünde tekerlek ile mesafe
    el.addEventListener('wheel', (e) => {
      e.preventDefault()
      this.capa.mesafe = Math.min(12, Math.max(0.6, this.capa.mesafe * (1 + Math.sign(e.deltaY) * 0.08)))
    }, { passive: false })
  }

  _pinchUzakligi() {
    const [a, b] = [...this._isaretciler.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  // ------------------------------------------------------- cihaz yönelimi

  /** Cihaz yönelim sensörünü bağlar; ürünün odada sabit kalmasını sağlar. */
  async yonelimiBagla() {
    if (typeof DeviceOrientationEvent === 'undefined') return false

    // iOS 13+: izin, kullanıcı hareketiyle aynı çağrı yığınında istenmeli.
    // Bu yüzden requestPermission BEKLENMEDEN, fonksiyonun ilk satırlarında
    // çağrılıyor (async gövde ilk await'e kadar eşzamanlı çalışır).
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') return false
      } catch {
        return false
      }
    }

    // İki olay da dinlenirse (Android'de ikisi de tetiklenebilir) biri mutlak
    // kuzeye, diğeri açılış anına göre yön verir; ürün iki değer arasında
    // gidip gelir. Mutlak olan varsa yalnızca onu kullanıyoruz.
    let kaynak = null
    let geldi = false

    const isle = (e) => {
      if (e.beta == null) return
      if (kaynak === null) kaynak = e.type
      if (e.type !== kaynak) return
      geldi = true
      // Portre modda telefon dike yakınken beta ≈ 90. Aşağı eğim = 90 - beta.
      const pitch = Math.min(85, Math.max(2, 90 - e.beta)) * DER
      const yawDer = e.webkitCompassHeading != null ? -e.webkitCompassHeading : (e.alpha ?? 0)
      const yaw = yawDer * DER

      // Yumuşatma — sensör gürültüsü ürünü titretmesin
      this.kamera.pitch += (pitch - this.kamera.pitch) * 0.25
      let fark = yaw - this.kamera.yaw
      while (fark > Math.PI) fark -= 2 * Math.PI
      while (fark < -Math.PI) fark += 2 * Math.PI
      this.kamera.yaw += fark * 0.25
    }

    // Önce mutlak yön denenir; kısa sürede gelmezse göreli olana düşülür.
    addEventListener('deviceorientationabsolute', isle)
    await new Promise((r) => setTimeout(r, 350))
    if (!geldi) addEventListener('deviceorientation', isle)

    await new Promise((r) => setTimeout(r, 500))
    this.sensorTuru = geldi ? kaynak : null
    if (geldi) this.sabitlemeyiAyarla(true)
    return geldi
  }

  /** Kamera görüntüsü + yerleştirilmiş ürünü tek kareye birleştirir. */
  async fotografCek() {
    const kaynak = this.video?.srcObject ? this.video : this.fonGorsel
    const c = document.createElement('canvas')
    c.width = this.G * 2
    c.height = this.Y * 2
    const ctx = c.getContext('2d')

    // Kaynağı canvas oranına göre kırparak kapla (object-fit: cover)
    const kg = kaynak.videoWidth || kaynak.naturalWidth
    const ky = kaynak.videoHeight || kaynak.naturalHeight
    if (kg && ky) {
      const olcek = Math.max(c.width / kg, c.height / ky)
      const g = kg * olcek
      const y = ky * olcek
      ctx.drawImage(kaynak, (c.width - g) / 2, (c.height - y) / 2, g, y)
    }
    ctx.drawImage(this.tuval, 0, 0, c.width, c.height)

    return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92))
  }
}
