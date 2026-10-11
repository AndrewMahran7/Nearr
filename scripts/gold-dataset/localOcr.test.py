"""Synthetic controls only: python scripts/gold-dataset/localOcr.test.py"""
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from PIL import Image, ImageDraw, ImageFont
import localOcr as ocr


def frame(file, text=None):
    image = Image.new('RGB', (960, 540), 'white')
    if text:
        font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf' if os.name == 'nt' else 'DejaVuSans.ttf', 58)
        ImageDraw.Draw(image).text((45, 215), text, font=font, fill='black')
    image.save(file, quality=95)


def fixture(root, count=20, text=True):
    parent = root/'neutral'; (parent/'frames').mkdir(parents=True)
    for i in range(count):
        frame(parent/f'frames/{i:03}.jpg', f'SYNTHETIC TEST {i:02}' if text else None)
    data = dict(schema_version=1, input_id='i_'+'a'*24, view='visual_only', cache_policy='disabled',
                evidence={'caption':'SECRET_METADATA_MUST_NOT_BECOME_OCR_TEXT'},
                media=dict(frames=[f'frames/{i:03}.jpg'for i in range(count)],
                           frame_timestamps_seconds=list(range(count)), duration_seconds=count))
    input_file = parent/'input.json'; input_file.write_text(json.dumps(data),encoding='utf8')
    return input_file, data


class FakeEngine:
    def __init__(self): self.requests=[]
    def __call__(self, args):
        if args == ['-Probe']:
            return dict(name='synthetic-test-engine', languages=['en-US'], word_confidence_available=False)
        request=json.loads(Path(args[1]).read_text()); self.requests.append(request)
        return dict(language=request['language'],items=[dict(relative_path=f['relative_path'],text='CONTROL TEXT',width=960,height=540,
                    text_angle=None,lines=[dict(text='CONTROL TEXT',words=[])],elapsed_ms=1)for f in request['frames']])


class LocalOcrTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='nearr-local-ocr-tests-');self.root=Path(self.temp.name)
    def tearDown(self): self.temp.cleanup()

    def test_time_probes_include_late_scene_despite_dense_opening(self):
        times=[i/100 for i in range(100)]+[10,20,30,40]
        chosen=ocr.probe_indices(times,40,8)
        self.assertIn(103,chosen);self.assertIn(0,chosen)
        self.assertGreaterEqual(sum(times[i]>=10 for i in chosen),3)

    def test_text_salience_distinguishes_reading_control_from_blank(self):
        frame(self.root/'blank.jpg');frame(self.root/'text.jpg','READING CONTROL 189')
        blank=ocr.text_salience(self.root/'blank.jpg',ocr.DEFAULT_CONFIG)
        text=ocr.text_salience(self.root/'text.jpg',ocr.DEFAULT_CONFIG)
        self.assertEqual(blank['score'],0)
        self.assertGreaterEqual(text['score'],ocr.DEFAULT_CONFIG['min_salience'])

    def test_sparse_budget_never_forwards_creator_metadata_and_immutable_output(self):
        src,_=fixture(self.root);original=src.read_bytes();engine=FakeEngine();out=self.root/'sidecar.json'
        result=ocr.run(src,out,config=dict(max_probes=12,max_frames=4,temporal_bins=4),engine_runner=engine)
        self.assertLessEqual(result['ocr_frames'],4);self.assertGreater(result['ocr_frames'],0)
        self.assertEqual(result['probed_frames'],12);self.assertEqual(src.read_bytes(),original)
        self.assertNotIn('SECRET_METADATA',out.read_text())
        self.assertEqual(set(engine.requests[0]),{'input_root','language','frames'})
        self.assertNotIn('caption',json.dumps(engine.requests))
        self.assertTrue(all(f['timestamp_seconds']>=0 and len(f['frame_sha256'])==64 for f in result['frames']))
        self.assertRaises(FileExistsError,ocr.run,src,out,engine_runner=engine)

    def test_blank_inputs_do_not_invoke_recognition(self):
        src,_=fixture(self.root,10,False);engine=FakeEngine()
        result=ocr.run(src,self.root/'blank.json',engine_runner=engine)
        self.assertEqual(result['ocr_frames'],0);self.assertEqual(engine.requests,[])
        self.assertEqual(result['status'],'skipped_no_salient_text_candidates')

    def test_duplicate_frames_are_not_repeated_and_late_bins_survive(self):
        probes=[dict(frame_index=i,timestamp_seconds=float(i),frame_sha256=str(i//2),salience={'score':.5})for i in range(12)]
        selected=ocr.select_frames(probes,12,{**ocr.DEFAULT_CONFIG,'max_frames':4,'temporal_bins':4})
        self.assertEqual(len(selected),4);self.assertEqual(len({p['frame_sha256']for p in selected}),4)
        self.assertTrue(any(p['timestamp_seconds']>=9 for p in selected))

    def test_unsafe_paths_wrong_view_and_timestamp_misalignment_fail_closed(self):
        src,data=fixture(self.root,2)
        variants=[]
        bad=copy.deepcopy(data);bad['media']['frames'][0]='../private.jpg';variants.append(bad)
        bad=copy.deepcopy(data);bad['view']='text_only';variants.append(bad)
        bad=copy.deepcopy(data);bad['media']['frame_timestamps_seconds']=[0];variants.append(bad)
        bad=copy.deepcopy(data);bad['expected_places']=['truth'];variants.append(bad)
        for bad in variants:
            src.write_text(json.dumps(bad));self.assertRaises(ValueError,ocr.neutral_input,src)
        src.write_text(json.dumps(data));self.assertRaises(ValueError,ocr.run,src,src.parent/'ocr.json',engine_runner=FakeEngine())

    def test_language_is_explicit_no_automatic_fallback(self):
        src,_=fixture(self.root,2)
        with self.assertRaisesRegex(ValueError,'ocr_language_unavailable'):
            ocr.run(src,self.root/'wrong-language.json',language='ja-JP',engine_runner=FakeEngine())

    def test_frame_mutation_after_selection_prevents_sidecar(self):
        src,_=fixture(self.root,2);fake=FakeEngine();out=self.root/'mutated.json'
        def engine(args):
            result=fake(args)
            if args!=['-Probe']:
                request=fake.requests[-1]
                target=Path(request['input_root'])/request['frames'][0]['relative_path']
                frame(target,'CHANGED SOURCE 456')
            return result
        with self.assertRaisesRegex(ValueError,'frame_changed_during_ocr'):
            ocr.run(src,out,engine_runner=engine)
        self.assertFalse(out.exists())

    @unittest.skipUnless(os.name=='nt','Windows local integration control')
    def test_real_winrt_reads_synthetic_control(self):
        engine=ocr.powershell(['-Probe'])
        if 'en-US'not in engine['languages']:self.skipTest('English OCR not installed')
        src,data=fixture(self.root,2,False)
        frame(src.parent/'frames/001.jpg','READING CONTROL 189')
        result=ocr.run(src,self.root/'real-control.json')
        text=' '.join(p['text']for p in result['frames']).upper()
        self.assertIn('READING CONTROL 189',text)
        self.assertEqual(result['ocr_frames'],1)
        self.assertTrue(result['frames'][0]['lines'][0]['words'])
        self.assertTrue(all(w['confidence']is None for line in result['frames'][0]['lines']for w in line['words']))
        self.assertEqual(result['frames'][0]['timestamp_seconds'],1)


if __name__=='__main__': unittest.main(verbosity=2)
