/**
 * Sign in: email and password, or a code sent to the phone — whichever the
 * server has switched on (GET /api/auth/config) — then the second factor if the
 * account has one. The phone gets its session token in the response body and
 * keeps it in secure storage (src/lib/api.ts).
 */

import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';

import { Button, Field, Meta, Notice, Screen, Txt } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { space, useTheme } from '@/theme';

type Method = 'email' | 'phone';

export default function SignIn() {
  const session = useSession();
  const { c, radius } = useTheme();
  const [phoneOffered, setPhoneOffered] = useState(false);
  // Unchosen until the owner picks: the phone code when offered, else email.
  const [chosen, setMethod] = useState<Method | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const method: Method = chosen ?? (phoneOffered ? 'phone' : 'email');
  // State updates are not synchronous: a second press in the same tick would
  // still see busy=false. The ref is what actually stops a double submit.
  const inFlight = useRef(false);

  useEffect(() => {
    session.api.get<{ methods: string[] }>('/api/auth/config')
      .then((cfg) => setPhoneOffered(cfg.methods.includes('phone_otp')))
      .catch(() => setPhoneOffered(false));
  }, [session.api]);

  async function run(step: () => Promise<unknown>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      await step();
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const finish = (result: { mfaToken: string } | object) => {
    if ('mfaToken' in result) { setMfaToken(result.mfaToken); setCode(''); }
  };

  const submitEmail = () => {
    if (!email.trim() || !password) { setProblem('Enter your email and password.'); return; }
    run(async () => finish(await session.login(email.trim(), password)));
  };

  const sendCode = () => {
    if (!phone.trim()) { setProblem('Enter your mobile number.'); return; }
    run(async () => { await session.requestCode(phone.trim()); setCodeSent(true); });
  };

  const submitCode = () => {
    if (!/^[0-9]{6}$/.test(code)) { setProblem('The code is 6 digits.'); return; }
    run(async () => finish(await session.verifyCode(phone.trim(), code)));
  };

  const submitMfa = () => {
    if (code.trim().length < 6) { setProblem('Enter the 6-digit code from your authenticator app, or a recovery code.'); return; }
    run(async () => { await session.verifyMfa(mfaToken!, code.trim()); });
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <View style={{ marginTop: space[8], gap: space[2] }}>
          <Meta>AutoSaarthi</Meta>
          <Txt step="display" weight="semibold" accessibilityRole="header">
            {mfaToken ? 'One more step' : 'Sign in'}
          </Txt>
          <Txt tone="muted">
            {mfaToken ? 'Your account has a second factor.' : 'See how your car is doing, and book its service.'}
          </Txt>
        </View>

        {!mfaToken && phoneOffered && (
          <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: c.inset, borderRadius: radius.control, padding: space[1] }}>
            {(['email', 'phone'] as const).map((m) => (
              <Pressable
                key={m}
                accessibilityRole="tab"
                accessibilityState={{ selected: method === m }}
                onPress={() => { setMethod(m); setProblem(null); setCode(''); }}
                android_ripple={{ color: c.insetStrong, borderless: false }}
                style={{
                  flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.control - 2,
                  backgroundColor: method === m ? c.card : 'transparent',
                }}
              >
                <Txt step="body" weight={method === m ? 'semibold' : 'regular'} tone={method === m ? 'fg' : 'muted'}>
                  {m === 'email' ? 'Email' : 'Phone'}
                </Txt>
              </Pressable>
            ))}
          </View>
        )}

        <View style={{ gap: space[4] }}>
          {mfaToken ? (
            <>
              <Field label="Authenticator or recovery code" value={code} onChangeText={setCode}
                     autoComplete="one-time-code" textContentType="oneTimeCode" autoCapitalize="none" />
              <Button onPress={submitMfa} busy={busy}>Verify</Button>
            </>
          ) : method === 'email' ? (
            <>
              <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address"
                     autoCapitalize="none" autoComplete="email" textContentType="emailAddress" />
              <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry
                     autoComplete="current-password" textContentType="password" onSubmitEditing={submitEmail} />
              <Button onPress={submitEmail} busy={busy}>Sign in</Button>
            </>
          ) : !codeSent ? (
            <>
              <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad"
                     autoComplete="tel" textContentType="telephoneNumber" placeholder="+91 98765 43210" />
              <Button onPress={sendCode} busy={busy}>Send code</Button>
            </>
          ) : (
            <>
              <Txt tone="muted">We sent a code to {phone.trim()}.</Txt>
              <Field label="6-digit code" value={code} onChangeText={setCode} keyboardType="number-pad"
                     autoComplete="sms-otp" textContentType="oneTimeCode" maxLength={6} />
              <Button onPress={submitCode} busy={busy}>Sign in</Button>
              <Button kind="ghost" onPress={() => { setCodeSent(false); setCode(''); }}>Use a different number</Button>
            </>
          )}
          {problem && <Notice>{problem}</Notice>}
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}
