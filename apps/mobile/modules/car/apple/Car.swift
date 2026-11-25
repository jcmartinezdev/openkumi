// What a car shows of the app, through CarPlay: the bots as a list, to call one with a tap, and
// the call while it lasts. The app says what to show (src/car.ts), as a whole each time, and this
// puts it on the car's screen with the screens CarPlay offers an app that is talked with: a list,
// the screen for a voice, and an alert. Nothing else can be drawn there.
//
// Over the list at most one thing shows at a time: the call or an alert. Putting one up and taking
// it down take a moment each, and CarPlay refuses a second while the first is on its way, so they
// are done one after the other, each time towards what the app wants by then.
import CarPlay
import ExpoModulesCore
import UIKit

struct CarRow: Record {
  @Field var id = ""
  @Field var title = ""
  @Field var detail = ""
  /// The name of a picture handed over with `keep`, or none.
  @Field var picture = ""
  /// Drawn in the picture's place when there is none.
  @Field var emoji = ""
}

struct CarCall: Record {
  /// Whose call it is: another one is another screen.
  @Field var id = ""
  @Field var name = ""
  /// "calling", "listening", "working" or "muted".
  @Field var state = "calling"
  @Field var picture = ""
  @Field var emoji = ""
}

struct CarAlert: Record {
  @Field var id = ""
  /// From the longest way of saying it to the shortest: the car shows the longest that fits.
  @Field var titles: [String] = []
  @Field var button = "OK"
}

struct CarScreen: Record {
  @Field var rows: [CarRow] = []
  /// Said in the list's place while it has no rows.
  @Field var note = ""
  @Field var noteDetail = ""
  /// A spinner with the note: something is on its way.
  @Field var busy = false
  @Field var call: CarCall?
  @Field var alert: CarAlert?
}

@MainActor
final class Car: NSObject, CPInterfaceControllerDelegate {
  static let shared = Car()

  /// Tells the app what was done on the car's screen. Set by the module once the app runs.
  var tell: ((_ event: String, _ body: [String: Any]) -> Void)?

  private var interface: CPInterfaceController?
  private var list: CPListTemplate?
  private var wanted = CarScreen()
  /// What the list was last filled with, in short: it is only filled again when that differs.
  private var filled: String?
  private var pictures: [String: UIImage] = [:]
  /// The same pictures at the sizes the car showed them, by name and size.
  private var sized: [String: UIImage] = [:]

  /// What shows over the list.
  private enum Over: Equatable {
    case nothing
    case call(String)
    case alert(String)
  }
  private var over = Over.nothing
  /// The list is on the car's screen: only then can anything be put over it.
  private var rooted = false
  /// One is being put up or taken down.
  private var settling = false
  /// The one CarPlay refused to put up: not tried again until something else is wanted.
  private var refused: Over?
  private var voice: CPVoiceControlTemplate?
  /// How often the call's screen was asked again for the state it should be in.
  private var asked = 0

  var connected: Bool { interface != nil }
  /// The app is what the car's screen shows, rather than a map or the car's own screens.
  var inFront = true

  // ---- the car

  func connect(_ interface: CPInterfaceController) {
    self.interface = interface
    interface.delegate = self
    let list = CPListTemplate(title: "OpenKumi", sections: [])
    self.list = list
    filled = nil
    over = .nothing
    settling = false
    refused = nil
    voice = nil
    rooted = false
    fill()
    interface.setRootTemplate(list, animated: false) { [weak self] _, _ in
      self?.rooted = true
      self?.settle()
    }
    tell?("onConnected", ["connected": true])
  }

  func disconnect() {
    interface = nil
    list = nil
    voice = nil
    over = .nothing
    settling = false
    // The next car starts with the list alone, until the app says what else there is.
    wanted.call = nil
    wanted.alert = nil
    tell?("onConnected", ["connected": false])
  }

  // ---- what the app wants shown

  func keep(_ name: String, png: String) {
    guard let data = Data(base64Encoded: png), let image = UIImage(data: data) else { return }
    pictures[name] = image
    sized = sized.filter { !$0.key.hasPrefix("\(name)@") }
    filled = nil
    fill()
  }

  func show(_ screen: CarScreen) {
    wanted = screen
    fill()
    settle()
  }

  private func fill() {
    guard let list else { return }
    // A list that is filled again starts over on the car's screen, so it is left alone while it says the same.
    let rows = wanted.rows.map { [$0.id, $0.title, $0.detail, pictures[$0.picture] == nil ? $0.emoji : $0.picture].joined(separator: "\u{1}") }
    let now = (rows + [wanted.note, wanted.noteDetail, wanted.busy ? "busy" : ""]).joined(separator: "\u{2}")
    if now == filled { return }
    filled = now
    let size = CPListItem.maximumImageSize
    // A car shows no more rows than this.
    let items = wanted.rows.prefix(Int(CPListTemplate.maximumItemCount)).map { row -> CPListItem in
      let item = CPListItem(text: row.title, detailText: row.detail.isEmpty ? nil : row.detail, image: picture(row.picture, emoji: row.emoji, side: min(size.width, size.height)))
      item.handler = { [weak self] _, done in
        self?.tell?("onPick", ["id": row.id])
        done()
      }
      return item
    }
    list.emptyViewTitleVariants = wanted.note.isEmpty ? [] : [wanted.note]
    list.emptyViewSubtitleVariants = wanted.noteDetail.isEmpty ? [] : [wanted.noteDetail]
    if #available(iOS 18.4, *) { list.showsSpinnerWhileEmpty = wanted.busy }
    list.updateSections(items.isEmpty ? [] : [CPListSection(items: items)])
  }

  /// A picture the app handed over, or its emoji drawn as one, at the size the car wants.
  private func picture(_ name: String, emoji: String, side: CGFloat) -> UIImage? {
    let box = CGSize(width: side, height: side)
    if let image = pictures[name] {
      let key = "\(name)@\(Int(side))"
      if let fitted = sized[key] { return fitted }
      // Sharp on any car's screen, whatever the phone's own.
      let format = UIGraphicsImageRendererFormat()
      format.scale = 3
      format.opaque = false
      let fitted = UIGraphicsImageRenderer(size: box, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: box)) }
      sized[key] = fitted
      return fitted
    }
    guard !emoji.isEmpty else { return nil }
    return UIGraphicsImageRenderer(size: box).image { _ in
      let text = NSAttributedString(string: emoji, attributes: [.font: UIFont.systemFont(ofSize: side * 0.78)])
      let drawn = text.size()
      text.draw(at: CGPoint(x: (side - drawn.width) / 2, y: (side - drawn.height) / 2))
    }
  }

  // ---- the call and the alert, over the list

  private func settle() {
    guard let interface, rooted, !settling else { return }
    let want: Over = wanted.alert.map { .alert($0.id) } ?? wanted.call.map { .call($0.id) } ?? .nothing
    if want != refused { refused = nil }
    if over == want {
      if case .call = over { showState() }
      return
    }
    // Taken down from the car meanwhile: there is nothing to take down.
    if over != .nothing, interface.presentedTemplate == nil {
      over = .nothing
      voice = nil
    }
    if over != .nothing {
      settling = true
      interface.dismissTemplate(animated: true) { [weak self] _, _ in
        guard let self else { return }
        self.over = .nothing
        self.voice = nil
        self.settling = false
        self.settle()
      }
      return
    }
    guard want != refused, let template = template(for: want) else { return }
    settling = true
    interface.presentTemplate(template, animated: true) { [weak self] shown, _ in
      guard let self else { return }
      self.settling = false
      if shown {
        self.over = want
      } else {
        self.refused = want
        // A call may only go on while its screen shows, and without it there is no way to end it from
        // the car: the app is told, and ends the call if it was made from here.
        if case .call(let id) = want { self.tell?("onAction", ["id": "noScreen", "of": id]) }
      }
      self.settle()
    }
  }

  /// Puts the call's screen in the state the call is in. The car takes only so many changes in a
  /// short while and drops the rest without saying so (a call goes through three as it begins), so a
  /// moment later it is looked at again, and asked again if it still shows another: a few times, not for ever.
  private func showState(again: Bool = false) {
    guard case .call = over, let call = wanted.call, let voice, voice.activeStateIdentifier != call.state else {
      asked = 0
      return
    }
    if again {
      guard asked < 4 else { return }
      asked += 1
    } else {
      asked = 0
    }
    voice.activateVoiceControlState(withIdentifier: call.state)
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
      guard let self, !self.settling else { return }
      self.showState(again: true)
    }
  }

  private func template(for over: Over) -> CPTemplate? {
    switch over {
    case .nothing:
      return nil
    case .alert:
      guard let alert = wanted.alert else { return nil }
      let id = alert.id
      return CPAlertTemplate(titleVariants: alert.titles, actions: [
        CPAlertAction(title: alert.button, style: .default) { [weak self] _ in self?.tell?("onAction", ["id": "dismiss", "of": id]) }
      ])
    case .call:
      guard let call = wanted.call else { return nil }
      let template = voiceTemplate(call)
      voice = template
      return template
    }
  }

  /// The call's screen: the bot, and in a few words how the call stands. What is said is not shown: it is heard.
  private func voiceTemplate(_ call: CarCall) -> CPVoiceControlTemplate {
    let image = picture(call.picture, emoji: call.emoji, side: 150)
    func state(_ id: String, _ titles: [String], buttons: [CPButton]) -> CPVoiceControlState {
      let state = CPVoiceControlState(identifier: id, titleVariants: titles, image: image, repeats: false)
      if #available(iOS 26.4, *) { state.actionButtons = buttons }
      return state
    }
    func button(_ symbol: String, _ title: String, _ action: String) -> CPButton {
      let button = CPButton(image: UIImage(systemName: symbol) ?? UIImage()) { [weak self] _ in self?.tell?("onAction", ["id": action, "of": call.id]) }
      button.title = title
      return button
    }
    let end = { button("phone.down.fill", "End", "hangUp") }
    let mute = { button("mic.slash.fill", "Mute", "mute") }
    let states = [
      state("calling", ["Calling \(call.name)…", "Calling…"], buttons: [end()]),
      state("listening", ["\(call.name) is listening", "Listening"], buttons: [mute(), end()]),
      state("working", ["\(call.name) is working on it…", "Working on it…"], buttons: [mute(), end()]),
      state("muted", ["\(call.name) cannot hear you", "Muted"], buttons: [button("mic.fill", "Unmute", "unmute"), end()]),
    ]
    // The screen starts on the first of its states, so the one the call is in goes first.
    let template = CPVoiceControlTemplate(voiceControlStates: states.filter { $0.identifier == call.state } + states.filter { $0.identifier != call.state })
    return template
  }

  // ---- CPInterfaceControllerDelegate

  /// The call's screen was taken down from the car (its back button, say), not by the app: the call
  /// ends with it, since a call may only go on while its screen shows. Looking at a map meanwhile is
  /// not that: the screen is still up when the app is come back to, and the call goes on. Which of
  /// the two it is shows a moment later.
  func templateDidDisappear(_ aTemplate: CPTemplate, animated: Bool) {
    guard !settling, aTemplate === voice else { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
      guard let self, self.inFront, !self.settling, aTemplate === self.voice, case .call(let id) = self.over else { return }
      self.over = .nothing
      self.voice = nil
      self.tell?("onAction", ["id": "hangUp", "of": id])
    }
  }
}
