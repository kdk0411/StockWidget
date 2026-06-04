' StockWidget - 콘솔창 없이 조용히 실행 (더블클릭용)
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

base = fso.GetParentFolderName(WScript.ScriptFullName)
electron = base & "\node_modules\electron\dist\electron.exe"

' 이 PC 환경변수 ELECTRON_RUN_AS_NODE=1 때문에 Electron이 Node로 떠버리는 것을 막는다.
' (변수가 "존재"하기만 해도 Node로 실행되므로, 빈 값 설정이 아니라 완전히 제거해야 한다.)
On Error Resume Next
sh.Environment("Process").Remove("ELECTRON_RUN_AS_NODE")
On Error Goto 0
sh.CurrentDirectory = base

If fso.FileExists(electron) Then
  ' 0 = 창 숨김, False = 종료까지 기다리지 않음
  sh.Run """" & electron & """ """ & base & """", 0, False
Else
  MsgBox "먼저 의존성을 설치하세요:" & vbCrLf & vbCrLf & _
         "stock-widget 폴더에서  npm install  실행", 48, "StockWidget"
End If
